import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class StatusMonitorService {
  private readonly logger = new Logger(StatusMonitorService.name);
  private cachedStatus: any = null;
  private lastFetchAt: Date | null = null;

  constructor(private config: ConfigService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async fetchExternalStatus() {
    const url = this.config.get<string>('EXTERNAL_STATUS_API_URL') || 'http://20.191.156.160/status/api';
    try {
      const response = await axios.get(url, { timeout: 5000 });
      this.cachedStatus = response.data;
      this.lastFetchAt = new Date();
    } catch (err) {
      this.logger.warn(`外部状态 API 不可达: ${err.message}`);
      if (!this.cachedStatus) {
        this.cachedStatus = { status: 'unknown', message: '外部服务状态暂时不可用' };
      }
    }
  }

  getStatus() {
    return {
      data: this.cachedStatus || { status: 'unknown', message: '尚未获取到状态数据' },
      lastFetchAt: this.lastFetchAt,
      isStale: this.lastFetchAt ? Date.now() - this.lastFetchAt.getTime() > 10 * 60 * 1000 : true,
    };
  }
}
