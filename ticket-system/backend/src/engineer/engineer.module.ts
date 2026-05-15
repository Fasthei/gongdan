import { Module } from '@nestjs/common';
import { EngineerService } from './engineer.service';
import { EngineerController, OperatorController } from './engineer.controller';

@Module({
  providers: [EngineerService],
  controllers: [EngineerController, OperatorController],
  exports: [EngineerService],
})
export class EngineerModule {}
