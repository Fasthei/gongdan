import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

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

  async refreshToken(token: string) {
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret',
      });
      const newPayload = { sub: payload.sub, role: payload.role, customerId: payload.customerId, engineerLevel: payload.engineerLevel };
      const accessToken = this.jwt.sign(newPayload, {
        secret: this.config.get<string>('JWT_SECRET') || 'default-secret',
        expiresIn: '15m',
      });
      return { accessToken, expiresIn: 900 };
    } catch {
      throw new UnauthorizedException('Refresh Token 无效或已过期');
    }
  }

  private signTokens(payload: any, user: any) {
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET') || 'default-secret',
      expiresIn: '15m',
    });
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET') || 'refresh-secret',
      expiresIn: '7d',
    });
    return { accessToken, refreshToken, expiresIn: 900, user };
  }
}
