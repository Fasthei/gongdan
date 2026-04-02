import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {
    const accessSecret = this.config.get<string>('JWT_SECRET');
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!accessSecret) throw new Error('JWT_SECRET is required');
    if (!refreshSecret) throw new Error('JWT_REFRESH_SECRET is required');
    this.accessSecret = accessSecret;
    this.refreshSecret = refreshSecret;
  }

  async customerLogin(customerCode: string) {
    const customer = await this.prisma.customer.findUnique({ where: { customerCode } });
    if (!customer) throw new UnauthorizedException('客户编号无效，请联系运营');

    const payload = { sub: customer.id, role: 'CUSTOMER', customerId: customer.id };
    return this.signTokens(payload, {
      id: customer.id,
      role: 'CUSTOMER',
      name: customer.name,
      customerCode: customer.customerCode,
      tier: customer.tier,
    });
  }

  async staffLogin(username: string, password: string) {
    // 先查工程师
    const engineer = await this.prisma.engineer.findUnique({ where: { username } });
    if (engineer) {
      const valid = await bcrypt.compare(password, engineer.passwordHash);
      if (!valid) throw new UnauthorizedException('用户名或密码错误');
      const payload = { sub: engineer.id, role: engineer.role, engineerLevel: engineer.level };
      return this.signTokens(payload, { id: engineer.id, role: engineer.role, username: engineer.username, level: engineer.level });
    }

    // 再查运营
    const operator = await this.prisma.operator.findUnique({ where: { username } });
    if (!operator) throw new UnauthorizedException('用户名或密码错误');
    const valid = await bcrypt.compare(password, operator.passwordHash);
    if (!valid) throw new UnauthorizedException('用户名或密码错误');
    const payload = { sub: operator.id, role: 'OPERATOR' };
    return this.signTokens(payload, { id: operator.id, role: 'OPERATOR', username: operator.username });
  }

  private async loadUserProfile(payload: any) {
    if (payload.role === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({ where: { id: payload.sub } });
      if (!customer) throw new UnauthorizedException('用户不存在');
      return {
        id: customer.id,
        role: 'CUSTOMER',
        name: customer.name,
        customerCode: customer.customerCode,
        tier: customer.tier,
      };
    }
    if (payload.role === 'OPERATOR') {
      const operator = await this.prisma.operator.findUnique({ where: { id: payload.sub } });
      if (!operator) throw new UnauthorizedException('用户不存在');
      return { id: operator.id, role: 'OPERATOR', username: operator.username };
    }
    const engineer = await this.prisma.engineer.findUnique({ where: { id: payload.sub } });
    if (!engineer) throw new UnauthorizedException('用户不存在');
    return { id: engineer.id, role: engineer.role, username: engineer.username, level: engineer.level };
  }

  private async revokeSessionByJti(jti?: string) {
    if (!jti) return;
    await this.prisma.authRefreshSession.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwt.verify(token, {
        secret: this.refreshSecret,
      });
      const active = await this.prisma.authRefreshSession.findFirst({
        where: {
          jti: payload.jti,
          userId: payload.sub,
          role: payload.role,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!active) throw new UnauthorizedException('Refresh Token 无效或已撤销');
      await this.revokeSessionByJti(payload.jti);
      const profile = await this.loadUserProfile(payload);
      const newPayload = { sub: payload.sub, role: payload.role, customerId: payload.customerId, engineerLevel: payload.engineerLevel };
      return this.signTokens(newPayload, profile);
    } catch {
      throw new UnauthorizedException('Refresh Token 无效或已过期');
    }
  }

  async logout(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, { secret: this.refreshSecret });
      await this.revokeSessionByJti(payload.jti);
      return { success: true };
    } catch {
      // logout is idempotent
      return { success: true };
    }
  }

  private async signTokens(payload: any, user: any) {
    const refreshJti = randomUUID();
    const accessToken = this.jwt.sign(payload, {
      secret: this.accessSecret,
      expiresIn: '15m',
    });
    const refreshToken = this.jwt.sign(payload, {
      secret: this.refreshSecret,
      jwtid: refreshJti,
      expiresIn: '7d',
    });
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await this.prisma.authRefreshSession.create({
      data: {
        userId: payload.sub,
        role: payload.role,
        jti: refreshJti,
        expiresAt,
      },
    });
    return { accessToken, refreshToken, expiresIn: 900, user };
  }
}
