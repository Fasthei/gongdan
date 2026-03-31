import { Controller, Get, UseGuards } from '@nestjs/common';
import { StatusMonitorService } from './status-monitor.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('status')
export class StatusMonitorController {
  constructor(private statusMonitorService: StatusMonitorService) {}

  @Get('external')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OPERATOR', 'ADMIN')
  getExternalStatus() {
    return this.statusMonitorService.getStatus();
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OPERATOR', 'ADMIN')
  getDashboard() {
    return this.statusMonitorService.getDashboard();
  }

  @Get('public-dashboard')
  getPublicDashboard() {
    return this.statusMonitorService.getDashboard();
  }
}
