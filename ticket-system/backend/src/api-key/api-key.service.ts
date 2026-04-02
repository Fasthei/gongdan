import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';

const VALID_MODULES = ['ticket', 'customer', 'engineer', 'attachment', 'statusMonitor'];

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function generateRawKey(): string {
  // Format: gd_live_<32 hex chars>
  return `gd_live_${randomBytes(20).toString('hex')}`;
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async createKey(dto: CreateApiKeyDto, createdBy: string) {
    const invalid = dto.allowedModules.filter((m) => !VALID_MODULES.includes(m));
    if (invalid.length > 0) {
      throw new BadRequestException(`无效模块: ${invalid.join(', ')}`);
    }

    const rawKey = generateRawKey();
    const keyHash = hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 16);

    const record = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        keyPrefix,
        keyHash,
        allowedModules: dto.allowedModules,
        enabled: true,
        createdBy,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      allowedModules: record.allowedModules,
      enabled: record.enabled,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      // 明文 key 仅此一次返回
      key: rawKey,
    };
  }

  async listKeys() {
    const keys = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        allowedModules: true,
        enabled: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        expiresAt: true,
        // keyHash 不返回给前端
      },
    });
    return keys;
  }

  async updateKey(id: string, dto: UpdateApiKeyDto) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API 密钥不存在');

    if (dto.allowedModules) {
      const invalid = dto.allowedModules.filter((m) => !VALID_MODULES.includes(m));
      if (invalid.length > 0) {
        throw new BadRequestException(`无效模块: ${invalid.join(', ')}`);
      }
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.allowedModules !== undefined && { allowedModules: dto.allowedModules }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }),
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        allowedModules: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    });
    return updated;
  }

  async revokeKey(id: string) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API 密钥不存在');
    await this.prisma.apiKey.delete({ where: { id } });
    return { success: true };
  }

  async validateKey(rawKey: string): Promise<{ id: string; allowedModules: string[] } | null> {
    if (!rawKey?.startsWith('gd_live_')) return null;

    const keyHash = hashKey(rawKey);
    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: { id: true, enabled: true, allowedModules: true, expiresAt: true },
    });

    if (!record || !record.enabled) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;

    // 异步更新 lastUsedAt，不阻塞请求
    void this.prisma.apiKey.update({
      where: { keyHash },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return { id: record.id, allowedModules: record.allowedModules };
  }
}
