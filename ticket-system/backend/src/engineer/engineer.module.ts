import { Module } from '@nestjs/common';
import { EngineerService } from './engineer.service';
import { EngineerController } from './engineer.controller';

@Module({
  providers: [EngineerService],
  controllers: [EngineerController],
  exports: [EngineerService],
})
export class EngineerModule {}
