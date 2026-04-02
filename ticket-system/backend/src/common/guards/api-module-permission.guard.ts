import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiPermissionsService, type ModuleKey } from '../../api-permissions/api-permissions.service';

const WHITELIST_PREFIXES = [
  '/api/auth/',
  '/api/health',
  '/api/public/bing-background',
  '/api/api-permissions/',
];

function isWhitelistedPath(path: string) {
  return WHITELIST_PREFIXES.some((p) => {
    if (p.endsWith('/')) return path.startsWith(p);
    return path === p || path.startsWith(`${p}/`);
  });
}

function resolveModuleKey(path: string): ModuleKey | null {
  // path is like: /api/tickets/:id or /api/status/dashboard
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
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path || req.url || '';

    if (isWhitelistedPath(path)) return true;

    const moduleKey = resolveModuleKey(path);
    if (!moduleKey) return true;

    const enabled = await this.apiPermissionsService.isModuleEnabled(moduleKey);
    if (!enabled) {
      throw new ForbiddenException(`API模块已关闭: ${moduleKey}`);
    }
    return true;
  }
}

