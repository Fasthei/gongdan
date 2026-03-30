import { Controller, Post, Patch, Get, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { EngineerService } from './engineer.service';
import {
  CreateEngineerDto,
  UpdateAvailabilityDto,
  UpdateEngineerEmailDto,
  ChangePasswordDto,
  CreateOperatorDto,
  AdminUpdateEngineerDto,
  AdminUpdateOperatorDto,
  AdminResetPasswordDto,
} from './dto/engineer.dto';
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

  @Patch('me/password')
  @Roles('ENGINEER', 'ADMIN')
  changePassword(@Body() dto: ChangePasswordDto, @Request() req: any) {
    return this.engineerService.changePassword(req.user.id, dto);
  }

  @Post('operators')
  @Roles('ADMIN')
  createOperator(@Body() dto: CreateOperatorDto, @Request() req: any) {
    return this.engineerService.createOperator(dto, req.user.id);
  }

  @Get('admin/engineers')
  @Roles('ADMIN')
  listEngineersForAdmin() {
    return this.engineerService.listEngineersForAdmin();
  }

  @Patch('admin/engineers/:id')
  @Roles('ADMIN')
  updateEngineerByAdmin(@Param('id') id: string, @Body() dto: AdminUpdateEngineerDto) {
    return this.engineerService.updateEngineerByAdmin(id, dto);
  }

  @Patch('admin/engineers/:id/password')
  @Roles('ADMIN')
  resetEngineerPasswordByAdmin(@Param('id') id: string, @Body() dto: AdminResetPasswordDto) {
    return this.engineerService.resetEngineerPasswordByAdmin(id, dto.newPassword);
  }

  @Delete('admin/engineers/:id')
  @Roles('ADMIN')
  deleteEngineerByAdmin(@Param('id') id: string, @Request() req: any) {
    return this.engineerService.deleteEngineerByAdmin(id, req.user.id);
  }

  @Get('admin/operators')
  @Roles('ADMIN')
  listOperatorsForAdmin() {
    return this.engineerService.listOperatorsForAdmin();
  }

  @Patch('admin/operators/:id')
  @Roles('ADMIN')
  updateOperatorByAdmin(@Param('id') id: string, @Body() dto: AdminUpdateOperatorDto) {
    return this.engineerService.updateOperatorByAdmin(id, dto);
  }

  @Patch('admin/operators/:id/password')
  @Roles('ADMIN')
  resetOperatorPasswordByAdmin(@Param('id') id: string, @Body() dto: AdminResetPasswordDto) {
    return this.engineerService.resetOperatorPasswordByAdmin(id, dto.newPassword);
  }

  @Delete('admin/operators/:id')
  @Roles('ADMIN')
  deleteOperatorByAdmin(@Param('id') id: string) {
    return this.engineerService.deleteOperatorByAdmin(id);
  }
}
