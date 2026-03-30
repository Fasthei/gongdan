import { Controller, Post, Get, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { CreateTicketDto } from './dto/ticket.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketController {
  constructor(private ticketService: TicketService) {}

  @Post()
  @Roles('CUSTOMER', 'OPERATOR', 'ADMIN')
  create(@Body() dto: CreateTicketDto, @Request() req: any) {
    return this.ticketService.create(dto, req.user.id, req.user.role);
  }

  @Post('for-customer/:customerId')
  @Roles('OPERATOR', 'ADMIN')
  createForCustomer(
    @Param('customerId') customerId: string,
    @Body() dto: CreateTicketDto,
    @Request() req: any,
  ) {
    return this.ticketService.createForCustomer(dto, customerId, req.user.id);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
  ) {
    return this.ticketService.findAll(req.user, parseInt(page), parseInt(pageSize), status);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.ticketService.findOne(id, req.user);
  }

  @Put(':id/status')
  @Roles('ENGINEER', 'ADMIN')
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Request() req: any) {
    return this.ticketService.updateStatus(id, status, req.user);
  }

  @Put(':id/assign')
  @Roles('OPERATOR', 'ADMIN')
  assign(@Param('id') id: string, @Body('engineerId') engineerId: string, @Request() req: any) {
    return this.ticketService.assignEngineer(id, engineerId, req.user.id);
  }

  @Put(':id/close-request')
  @Roles('ENGINEER', 'ADMIN')
  closeRequest(@Param('id') id: string, @Request() req: any) {
    return this.ticketService.requestClose(id, req.user.id);
  }

  @Put(':id/close-approve')
  @Roles('OPERATOR', 'ADMIN')
  closeApprove(@Param('id') id: string, @Request() req: any) {
    return this.ticketService.approveClose(id, req.user.id);
  }

  @Put(':id/close-reject')
  @Roles('OPERATOR', 'ADMIN')
  closeReject(@Param('id') id: string, @Request() req: any) {
    return this.ticketService.rejectClose(id, req.user.id);
  }

  @Post(':id/urge')
  @Roles('OPERATOR', 'ADMIN')
  urge(@Param('id') id: string, @Body('note') note: string, @Request() req: any) {
    return this.ticketService.urge(id, req.user.id, note);
  }
}
