import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { CasdoorService } from './casdoor.service';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private casdoor: CasdoorService,
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

  /** 前端获取 Casdoor 授权 URL */
  getCasdoorAuthorizeUrl() {
    return this.casdoor.buildAuthorizeUrl();
  }

  /**
   * Casdoor OAuth 回调：
   * 1. 用 code 换 Casdoor user
   * 2. 依据 groups/roles 映射到 ENGINEER / OPERATOR / ADMIN
   * 3. 通过 casdoorId 或 email 查找/自动建档
   * 4. 签发本系统 JWT
   */
  async casdoorCallback(code: string, state: string) {
    const user = await this.casdoor.exchangeCodeForUser(code, state);
    if (!user.sub) throw new UnauthorizedException('Casdoor 返回用户缺少 sub');
    const mapped = this.casdoor.mapRole(user);

    if (mapped.type === 'operator') {
      const op = await this.upsertOperator(user);
      const payload = { sub: op.id, role: 'OPERATOR' };
      return this.signTokens(payload, { id: op.id, role: 'OPERATOR', username: op.username });
    }

    // engineer / admin
    const eng = await this.upsertEngineer(user, mapped);
    const payload = { sub: eng.id, role: eng.role, engineerLevel: eng.level };
    return this.signTokens(payload, {
      id: eng.id,
      role: eng.role,
      username: eng.username,
      level: eng.level,
    });
  }

  private async upsertEngineer(
    user: { sub: string; name: string; email?: string; displayName?: string },
    mapped: { role: 'ENGINEER' | 'ADMIN'; level?: 'L1' | 'L2' | 'L3' },
  ) {
    // 1. 按 casdoorId 精确匹配
    let eng = await this.prisma.engineer.findUnique({ where: { casdoorId: user.sub } });
    // 2. 回退：按 email 绑定旧账号
    if (!eng && user.email) {
      const byEmail = await this.prisma.engineer.findUnique({ where: { email: user.email } });
      if (byEmail) {
        eng = await this.prisma.engineer.update({
          where: { id: byEmail.id },
          data: {
            casdoorId: user.sub,
            role: mapped.role,
            level: mapped.level ?? byEmail.level,
          },
        });
      }
    }
    // 3. 自动建档
    if (!eng) {
      const email = user.email || `${user.name}@casdoor.local`;
      eng = await this.prisma.engineer.create({
        data: {
          username: user.name,
          email,
          casdoorId: user.sub,
          role: mapped.role,
          level: mapped.level ?? 'L1',
          createdBy: 'casdoor',
        },
      });
    } else if (eng.role !== mapped.role || (mapped.level && eng.level !== mapped.level)) {
      // 4. 角色/等级变更同步
      eng = await this.prisma.engineer.update({
        where: { id: eng.id },
        data: { role: mapped.role, level: mapped.level ?? eng.level },
      });
    }
    return eng;
  }

  private async upsertOperator(user: { sub: string; name: string; email?: string }) {
    let op = await this.prisma.operator.findUnique({ where: { casdoorId: user.sub } });
    if (!op && user.email) {
      const byEmail = await this.prisma.operator.findUnique({ where: { email: user.email } });
      if (byEmail) {
        op = await this.prisma.operator.update({
          where: { id: byEmail.id },
          data: { casdoorId: user.sub },
        });
      }
    }
    if (!op) {
      const email = user.email || `${user.name}@casdoor.local`;
      op = await this.prisma.operator.create({
        data: {
          username: user.name,
          email,
          casdoorId: user.sub,
          createdBy: 'casdoor',
        },
      });
    }
    return op;
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
