import { Module, Global } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';

@Global()
@Module({
  providers: [KnowledgeBaseService],
  controllers: [KnowledgeBaseController],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
