import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiPermissionsController } from './api-permissions.controller';
import { ApiPermissionsService } from './api-permissions.service';
import { ApiModulePermissionGuard } from '../common/guards/api-module-permission.guard';

@Module({
  controllers: [ApiPermissionsController],
  providers: [
    ApiPermissionsService,
    {
      provide: APP_GUARD,
      useClass: ApiModulePermissionGuard,
    },
  ],
})
export class ApiPermissionsModule {}

