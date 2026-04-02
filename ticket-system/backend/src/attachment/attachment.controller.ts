import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('attachments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttachmentController {
  constructor(private attachmentService: AttachmentService) {}

  @Post('sas-token')
  @Roles('CUSTOMER', 'ENGINEER', 'ADMIN', 'OPERATOR')
  generateSasToken(@Body('fileName') fileName: string) {
    const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    return this.attachmentService.generateSasToken(safeName);
  }
}
