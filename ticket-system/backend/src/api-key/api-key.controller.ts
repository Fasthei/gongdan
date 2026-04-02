import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';

@Controller('api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  list() {
    return this.apiKeyService.listKeys();
  }

  @Post()
  create(@Body() dto: CreateApiKeyDto, @Req() req: any) {
    return this.apiKeyService.createKey(dto, req.user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
    return this.apiKeyService.updateKey(id, dto);
  }

  @Delete(':id')
  revoke(@Param('id') id: string) {
    return this.apiKeyService.revokeKey(id);
  }
}
