import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SlaMonitorService {
  private readonly logger = new Logger(SlaMonitorService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async checkSlaOverdue() {
    const now = new Date();
    const overdueTickets = await this.prisma.ticket.findMany({
      where: {
        slaDeadline: { lt: now },
        status: { notIn: ['CLOSED'] },
      },
      include: { customer: { select: { name: true, tier: true } } },
    });

    if (overdueTickets.length > 0) {
      this.logger.warn(`发现 ${overdueTickets.length} 个 SLA 超时工单`);
      for (const ticket of overdueTickets) {
        this.logger.warn(`工单 ${ticket.ticketNumber} 已超时，客户: ${ticket.customer.name}，等级: ${ticket.customer.tier}`);
      }
    }
  }
}
