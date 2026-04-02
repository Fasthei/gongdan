import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiPermissionsService, type ModuleKey } from '../../api-permissions/api-permissions.service';

const WHITELIST_PREFIXES = [
  '/api/auth/',
  '/api/health',
  '/api/public/bing-background',
  '/api/api-permissions/',
  '/api/api-keys/',
  '/api/api-keys',
];

function isWhitelistedPath(path: string) {
  return WHITELIST_PREFIXES.some((p) => {
    if (p.endsWith('/')) return path.startsWith(p);
    return path === p || path.startsWith(`${p}/`);
  });
}

function resolveModuleKey(path: string): ModuleKey | null {
  if (path.startsWith('/api/tickets')) return 'ticket';
  if (path.startsWith('/api/customers')) return 'customer';
  if (path.startsWith('/api/engineers')) return 'engineer';
  if (path.startsWith('/api/attachments')) return 'attachment';
  if (path.startsWith('/api/status')) return 'statusMonitor';
  return null;
}

@Injectable()
export class ApiModulePermissionGuard implements CanActivate {
  constructor(private readonly apiPermissionsService: ApiPermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { apiClient?: { id: string; allowedModules: string[] } }>();
    const path = req.path || req.url || '';

    if (isWhitelistedPath(path)) return true;

    const moduleKey = resolveModuleKey(path);
    if (!moduleKey) return true;

    // API Key 认证：检查密钥的 allowedModules
    if (req.apiClient) {
      if (!req.apiClient.allowedModules.includes(moduleKey)) {
        throw new ForbiddenException(`该 API 密钥无权访问模块: ${moduleKey}`);
      }
      return true;
    }

    // JWT 用户认证：检查全局模块开关
    const enabled = await this.apiPermissionsService.isModuleEnabled(moduleKey);
    if (!enabled) {
      throw new ForbiddenException(`API模块已关闭: ${moduleKey}`);
    }
    return true;
  }
}

