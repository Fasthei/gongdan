import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatusMonitorService {
  private readonly logger = new Logger(StatusMonitorService.name);
  private cachedStatus: any = null;
  private lastFetchAt: Date | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

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

  async getDashboard() {
    if (!this.cachedStatus) {
      await this.fetchExternalStatus();
    }
    const external = this.getStatus();

    const engineers = await this.prisma.engineer.findMany({
      select: { id: true, username: true, level: true, isAvailable: true },
      orderBy: [{ isAvailable: 'desc' }, { level: 'desc' }, { username: 'asc' }],
    });
    const engineerIds = engineers.map((e) => e.id);

    const activeTickets = engineerIds.length
      ? await this.prisma.ticket.findMany({
          where: {
            assignedEngineerId: { in: engineerIds },
            status: { in: ['ACCEPTED', 'IN_PROGRESS', 'PENDING_CLOSE'] },
          },
          select: {
            id: true,
            ticketNumber: true,
            status: true,
            updatedAt: true,
            assignedEngineerId: true,
            customer: { select: { name: true, customerCode: true } },
          },
          orderBy: [{ updatedAt: 'desc' }],
        })
      : [];

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const closedGroups = engineerIds.length
      ? await this.prisma.ticket.groupBy({
          by: ['assignedEngineerId'],
          where: {
            assignedEngineerId: { in: engineerIds },
            status: 'CLOSED',
            closedAt: { gte: since },
          },
          _count: { _all: true },
        })
      : [];
    const closedMap = new Map(
      closedGroups
        .filter((g) => !!g.assignedEngineerId)
        .map((g) => [String(g.assignedEngineerId), g._count._all]),
    );

    const engineerRows = engineers.map((e) => {
      const current = activeTickets.filter((t) => t.assignedEngineerId === e.id);
      const closed7d = closedMap.get(e.id) || 0;
      return {
        id: e.id,
        username: e.username,
        level: e.level,
        isOnline: !!e.isAvailable,
        activeTicketCount: current.length,
        currentTickets: current.map((t) => ({
          id: t.id,
          ticketNumber: t.ticketNumber,
          status: t.status,
          customerName: t.customer?.name || '',
          customerCode: t.customer?.customerCode || '',
          updatedAt: t.updatedAt,
        })),
        closed7d,
        avgPerDay7d: Number((closed7d / 7).toFixed(2)),
      };
    });

    const onlineCount = engineerRows.filter((e) => e.isOnline).length;
    const totalActiveTickets = engineerRows.reduce((sum, e) => sum + e.activeTicketCount, 0);
    const totalClosed7d = engineerRows.reduce((sum, e) => sum + e.closed7d, 0);
    const avgPerEngineerPerDay7d = engineerRows.length
      ? Number((totalClosed7d / 7 / engineerRows.length).toFixed(2))
      : 0;

    return {
      external,
      summary: {
        engineersTotal: engineerRows.length,
        engineersOnline: onlineCount,
        onlineRate: engineerRows.length ? Number((onlineCount / engineerRows.length).toFixed(4)) : 0,
        totalActiveTickets,
        totalClosed7d,
        avgPerEngineerPerDay7d,
      },
      engineers: engineerRows,
      generatedAt: new Date().toISOString(),
    };
  }
}
