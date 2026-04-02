import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeyService } from '../../api-key/api-key.service';

/**
 * 读取 X-Api-Key header，验证 API 密钥并将客户端信息注入 req.apiClient。
 * 不抛异常：若无 API Key 则跳过，由后续的 JwtAuthGuard 处理用户认证。
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { apiClient?: { id: string; allowedModules: string[] } }>();
    const rawKey = req.headers['x-api-key'] as string | undefined;

    if (!rawKey) return true;

    const client = await this.apiKeyService.validateKey(rawKey);
    if (client) {
      req.apiClient = client;
    }
    return true;
  }
}
