import { Controller, Get, UseGuards } from '@nestjs/common';
import { StatusMonitorService } from './status-monitor.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('status')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StatusMonitorController {
  constructor(private statusMonitorService: StatusMonitorService) {}

  @Get('external')
  @Roles('OPERATOR', 'ADMIN')
  getExternalStatus() {
    return this.statusMonitorService.getStatus();
  }
}
