import { Controller, Post, Patch, Get, Body, UseGuards, Request } from '@nestjs/common';
import { EngineerService } from './engineer.service';
import { CreateEngineerDto, UpdateAvailabilityDto, UpdateEngineerEmailDto } from './dto/engineer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('engineers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EngineerController {
  constructor(private engineerService: EngineerService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateEngineerDto, @Request() req: any) {
    return this.engineerService.create(dto, req.user.id);
  }

  @Get()
  @Roles('OPERATOR', 'ADMIN')
  findAll() {
    return this.engineerService.findAll();
  }

  @Patch('me/availability')
  @Roles('ENGINEER', 'ADMIN')
  updateAvailability(@Body() dto: UpdateAvailabilityDto, @Request() req: any) {
    return this.engineerService.updateAvailability(req.user.id, dto);
  }

  @Patch('me/email')
  @Roles('ENGINEER', 'ADMIN')
  updateEmail(@Body() dto: UpdateEngineerEmailDto, @Request() req: any) {
    return this.engineerService.updateEmail(req.user.id, dto);
  }
}
