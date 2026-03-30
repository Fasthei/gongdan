import { Controller, Post, Patch, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto, UpdateCustomerTierDto, BindEngineerDto } from './dto/customer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerController {
  constructor(private customerService: CustomerService) {}

  @Post()
  @Roles('OPERATOR')
  create(@Body() dto: CreateCustomerDto, @Request() req: any) {
    return this.customerService.create(dto, req.user.id);
  }

  @Get()
  @Roles('OPERATOR', 'ADMIN')
  findAll() {
    return this.customerService.findAll();
  }

  @Get(':id')
  @Roles('OPERATOR', 'ADMIN')
  findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
  }

  @Patch(':id/tier')
  @Roles('OPERATOR')
  updateTier(@Param('id') id: string, @Body() dto: UpdateCustomerTierDto, @Request() req: any) {
    return this.customerService.updateTier(id, dto, req.user.id);
  }

  @Patch(':id/bind-engineer')
  @Roles('OPERATOR')
  bindEngineer(@Param('id') id: string, @Body() dto: BindEngineerDto, @Request() req: any) {
    return this.customerService.bindEngineer(id, dto.engineerId, req.user.id);
  }
}
