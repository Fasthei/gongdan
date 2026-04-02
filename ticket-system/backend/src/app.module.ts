import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CustomerModule } from './customer/customer.module';
import { EngineerModule } from './engineer/engineer.module';
import { TicketModule } from './ticket/ticket.module';
import { AttachmentModule } from './attachment/attachment.module';
import { NotificationModule } from './notification/notification.module';
import { StatusMonitorModule } from './status-monitor/status-monitor.module';
import { ApiPermissionsModule } from './api-permissions/api-permissions.module';
import { ApiKeyModule } from './api-key/api-key.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    CustomerModule,
    EngineerModule,
    TicketModule,
    AttachmentModule,
    NotificationModule,
    StatusMonitorModule,
    ApiPermissionsModule,
    ApiKeyModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
