import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { SlaMonitorService } from './sla-monitor.service';

@Module({
  providers: [TicketService, SlaMonitorService],
  controllers: [TicketController],
  exports: [TicketService],
})
export class TicketModule {}
