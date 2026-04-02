import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiPermissionsController } from './api-permissions.controller';
import { ApiPermissionsService } from './api-permissions.service';
import { ApiModulePermissionGuard } from '../common/guards/api-module-permission.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ApiKeyModule } from '../api-key/api-key.module';

@Module({
  imports: [ApiKeyModule],
  controllers: [ApiPermissionsController],
  providers: [
    ApiPermissionsService,
    // ApiKeyGuard 先于 ApiModulePermissionGuard 运行，将 req.apiClient 注入
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiModulePermissionGuard,
    },
  ],
})
export class ApiPermissionsModule {}

