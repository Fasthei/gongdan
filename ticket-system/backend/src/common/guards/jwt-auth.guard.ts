import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

/** 仅允许 JWT 用户访问的管理接口（API Key 即使有效也必须拒绝） */
const API_KEY_FORBIDDEN_PREFIXES = ['/api/api-keys', '/api/api-permissions'];

function isForbiddenPathForApiKey(req: Request): boolean {
  const path = req.path || req.url?.split('?')[0] || '';
  return API_KEY_FORBIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * JWT 或有效 API Key（由全局 ApiKeyGuard 注入 req.apiClient）均可通过。
 * API Key 请求会注入合成 user（ADMIN 视角，便于工单/客户等列表与 JWT 行为一致），
 * 但禁止访问 API 密钥与权限开关等仅管理端接口。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<
      Request & { apiClient?: { id: string; allowedModules: string[] }; user?: unknown }
    >();
    if (req.apiClient) {
      if (isForbiddenPathForApiKey(req)) {
        throw new UnauthorizedException('API 密钥不可访问该管理接口');
      }
      req.user = {
        id: `api-key:${req.apiClient.id}`,
        role: 'ADMIN',
        apiKeyId: req.apiClient.id,
      };
      return true;
    }
    return super.canActivate(context) as boolean | Promise<boolean>;
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
