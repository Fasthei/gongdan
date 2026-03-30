import { Controller, Post, Body, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('knowledge-base')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KnowledgeBaseController {
  constructor(private kbService: KnowledgeBaseService) {}

  @Post('search')
  @Roles('ENGINEER', 'ADMIN', 'OPERATOR')
  search(@Body() body: { query: string; platform?: string; topK?: number; searchMode?: 'hybrid' | 'keyword' | 'vector' }) {
    return this.kbService.search(body.query, {
      platform: body.platform,
      topK: body.topK,
      searchMode: body.searchMode,
    });
  }

  @Post('smart-query')
  @Roles('ENGINEER', 'ADMIN')
  smartQuery(@Body() body: { question: string; topK?: number }) {
    return this.kbService.smartQuery(body.question, body.topK);
  }

  @Post('upload')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: any,
    @Body() body: { platform?: string; title?: string },
  ) {
    return this.kbService.uploadDocument(file, {
      platform: body.platform,
      title: body.title,
    });
  }
}
