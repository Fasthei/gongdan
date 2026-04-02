import { Body, Controller, Get, Patch, Param, Req, UseGuards } from '@nestjs/common';
import { ApiPermissionsService, type ModuleKey } from './api-permissions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BatchUpdateModulesDto, UpdateModuleEnabledDto } from './dto/update-module-enabled.dto';
import { BadRequestException } from '@nestjs/common';

@Controller('api-permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ApiPermissionsController {
  constructor(private readonly apiPermissionsService: ApiPermissionsService) {}

  @Get('modules')
  getModules() {
    return this.apiPermissionsService.getAllModules();
  }

  @Patch('modules/:moduleKey')
  async updateModule(
    @Param('moduleKey') moduleKey: string,
    @Body() dto: UpdateModuleEnabledDto,
    @Req() req: any,
  ) {
    // 管理端校验合法模块键并记录操作者
    return this.apiPermissionsService.setModuleEnabled(moduleKey, dto.enabled, req.user?.id ?? null);
  }

  @Patch('modules/batch')
  async batchUpdate(
    @Body() dto: BatchUpdateModulesDto,
    @Req() req: any,
  ) {
    if (!Array.isArray(dto.modules) || dto.modules.length === 0) {
      throw new BadRequestException('modules is empty');
    }

    const results: Array<{ moduleKey: ModuleKey; enabled: boolean }> = [];
    for (const item of dto.modules) {
      const r = await this.apiPermissionsService.setModuleEnabled(item.moduleKey, item.enabled, req.user?.id ?? null);
      results.push(r as any);
    }
    return { results };
  }
}

