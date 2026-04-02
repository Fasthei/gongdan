import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const MODULE_KEYS = ['ticket', 'customer', 'engineer', 'attachment', 'statusMonitor'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModulePermissionView {
  moduleKey: ModuleKey;
  enabled: boolean;
  updatedAt?: Date;
  updatedBy?: string | null;
}

@Injectable()
export class ApiPermissionsService {
  private cache: {
    loadedAt: number;
    enabledByKey: Record<ModuleKey, boolean>;
    metaByKey: Partial<Record<ModuleKey, Pick<ModulePermissionView, 'updatedAt' | 'updatedBy'>>>;
  } | null = null;

  // 缓存 API 权限，降低每个请求都 hit PG 的压力
  private readonly cacheTtlMs = 5000;

  constructor(private readonly prisma: PrismaService) {}

  private ensureCacheFresh = async () => {
    if (this.cache && Date.now() - this.cache.loadedAt < this.cacheTtlMs) return;

    // 默认策略：未配置记录 => 视为 enabled（避免全站默认不可用）
    const enabledByKey: Record<ModuleKey, boolean> = {
      ticket: true,
      customer: true,
      engineer: true,
      attachment: true,
      statusMonitor: true,
    };
    const metaByKey: Partial<Record<ModuleKey, Pick<ModulePermissionView, 'updatedAt' | 'updatedBy'>>> = {};

    const rows = await this.prisma.apiModulePermission.findMany();
    for (const r of rows) {
      const k = r.moduleKey as ModuleKey;
      if (!MODULE_KEYS.includes(k)) continue;
      enabledByKey[k] = !!r.enabled;
      metaByKey[k] = { updatedAt: r.updatedAt, updatedBy: r.updatedBy };
    }

    this.cache = { loadedAt: Date.now(), enabledByKey, metaByKey };
  };

  async getAllModules(): Promise<ModulePermissionView[]> {
    await this.ensureCacheFresh();
    if (!this.cache) return [];
    return MODULE_KEYS.map((moduleKey) => ({
      moduleKey,
      enabled: this.cache.enabledByKey[moduleKey],
      updatedAt: this.cache.metaByKey[moduleKey]?.updatedAt,
      updatedBy: this.cache.metaByKey[moduleKey]?.updatedBy ?? null,
    }));
  }

  async isModuleEnabled(moduleKey: ModuleKey): Promise<boolean> {
    await this.ensureCacheFresh();
    return this.cache ? this.cache.enabledByKey[moduleKey] : true;
  }

  private assertValidModuleKey(moduleKey: string): asserts moduleKey is ModuleKey {
    if (!MODULE_KEYS.includes(moduleKey as ModuleKey)) {
      throw new BadRequestException(`unknown moduleKey: ${moduleKey}`);
    }
  }

  async setModuleEnabled(moduleKey: string, enabled: boolean, updatedBy: string | null) {
    this.assertValidModuleKey(moduleKey);
    const key = moduleKey as ModuleKey;

    await this.prisma.apiModulePermission.upsert({
      where: { moduleKey: key },
      create: { moduleKey: key, enabled, updatedBy },
      update: { enabled, updatedBy },
    });

    // 写入后立即刷新缓存
    this.cache = null;
    return { moduleKey: key, enabled };
  }
}

