import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/** 仅允许 JWT 用户访问的管理接口（API Key 即使有效也必须拒绝） */
const API_KEY_FORBIDDEN_PREFIXES = ['/api/api-keys', '/api/api-permissions'];

function isForbiddenPathForApiKey(req: Request): boolean {
  const path = req.path || req.url?.split('?')[0] || '';
  return API_KEY_FORBIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function getCustomerCodeHeader(req: Request): string | undefined {
  const raw = req.headers?.['x-customer-code'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * JWT 或有效 API Key（由全局 ApiKeyGuard 注入 req.apiClient）均可通过。
 *
 * API Key 请求的两种分支：
 * 1) 带 `X-Customer-Code: <code>` header → 以该客户身份调用（CUSTOMER 视角），
 *    用于 chat-gw 把 LobeChat 终端客户请求转发到 gongdan 时做数据越权隔离。
 * 2) 未带 header → 沿用 ADMIN 视角（员工/系统路径）。
 *
 * 同时禁止任何 API Key 请求访问 API 密钥与权限开关等仅管理端接口。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & { apiClient?: { id: string; allowedModules: string[] }; user?: unknown }
    >();
    if (req.apiClient) {
      if (isForbiddenPathForApiKey(req)) {
        throw new UnauthorizedException('API 密钥不可访问该管理接口');
      }

      const customerCode = getCustomerCodeHeader(req);
      if (customerCode) {
        const customer = await this.prisma.customer.findUnique({
          where: { customerCode },
        });
        if (!customer) {
          throw new UnauthorizedException('unknown customer code');
        }
        req.user = {
          id: `customer:${customer.id}`,
          customerId: customer.id,
          customerCode: customer.customerCode,
          role: 'CUSTOMER',
          apiKeyId: req.apiClient.id,
        };
        return true;
      }

      req.user = {
        id: `api-key:${req.apiClient.id}`,
        role: 'ADMIN',
        apiKeyId: req.apiClient.id,
      };
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }

  handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<
      Request & { apiClient?: { id: string; allowedModules: string[] }; user?: unknown }
    >();
    if (req.apiClient && req.user) return req.user;
    if (err || !user) throw new UnauthorizedException('无效的认证令牌');
    return user;
  }
}
