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
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { StatusMonitorModule } from './status-monitor/status-monitor.module';

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
    KnowledgeBaseModule,
    StatusMonitorModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
