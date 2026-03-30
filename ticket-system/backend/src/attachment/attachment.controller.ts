import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentController {
  constructor(private attachmentService: AttachmentService) {}

  @Post('sas-token')
  generateSasToken(@Body('fileName') fileName: string) {
    const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    return this.attachmentService.generateSasToken(safeName);
  }
}
