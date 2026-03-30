import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceBusClient } from '@azure/service-bus';
import axios from 'axios';

export interface DomainEvent {
  type: 'ticket.created' | 'ticket.assigned' | 'ticket.status_changed' | 'ticket.close_requested' | 'ticket.closed';
  ticketId: string;
  ticketNumber: string;
  payload: Record<string, any>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private config: ConfigService) {}

  async publishEvent(event: DomainEvent): Promise<void> {
    const connStr = this.config.get<string>('AZURE_SERVICE_BUS_CONNECTION_STRING');
    const queueName = this.config.get<string>('AZURE_SERVICE_BUS_QUEUE_NAME') || 'ticket-events';

    if (!connStr) {
      this.logger.debug(`[Mock] 发布事件: ${event.type} - 工单 ${event.ticketNumber}`);
      await this.sendTeamsNotification(event);
      return;
    }

    try {
      const client = new ServiceBusClient(connStr);
      const sender = client.createSender(queueName);
      await sender.sendMessages({ body: event, contentType: 'application/json' });
      await sender.close();
      await client.close();
      // Also notify Teams directly so operators can see events
      // even when no downstream consumer handles the queue.
      await this.sendTeamsNotification(event);
    } catch (err) {
      this.logger.error(`Service Bus 发布失败: ${err.message}`, err.stack);
      // 降级：直接发 Teams
      await this.sendTeamsNotification(event);
    }
  }

  async sendTeamsNotification(event: DomainEvent): Promise<void> {
    const webhookUrl = this.config.get<string>('TEAMS_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.debug(`[Mock Teams] ${event.type}: 工单 ${event.ticketNumber}`);
      return;
    }

    const messageMap: Record<string, string> = {
      'ticket.created':         `📋 新工单 ${event.ticketNumber} 已创建，等待受理`,
      'ticket.assigned':        `👷 工单 ${event.ticketNumber} 已分配给工程师`,
      'ticket.status_changed':  `🔄 工单 ${event.ticketNumber} 状态已更新`,
      'ticket.close_requested': `⏳ 工单 ${event.ticketNumber} 申请关闭，等待运营审批`,
      'ticket.closed':          `✅ 工单 ${event.ticketNumber} 已关闭`,
    };

    try {
      await axios.post(webhookUrl, {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: messageMap[event.type] || event.type,
        text: messageMap[event.type] || event.type,
      });
    } catch (err) {
      this.logger.error(`Teams 通知发送失败: ${err.message}`);
    }
  }
}
