import { Module } from '@nestjs/common';
import { StatusMonitorService } from './status-monitor.service';
import { StatusMonitorController } from './status-monitor.controller';

@Module({
  providers: [StatusMonitorService],
  controllers: [StatusMonitorController],
})
export class StatusMonitorModule {}
