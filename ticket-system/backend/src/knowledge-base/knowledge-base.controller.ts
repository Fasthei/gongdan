import { Controller, Post, Body, UseGuards, UploadedFile, UseInterceptors, Get, Param, Res, Req } from '@nestjs/common';
import { Response } from 'express';
import { KnowledgeBaseService } from './knowledge-base.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { Request } from '@nestjs/common';

@Controller('knowledge-base')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KnowledgeBaseController {
  constructor(
    private kbService: KnowledgeBaseService,
    private prisma: PrismaService,
  ) {}

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
  @Roles('ENGINEER', 'ADMIN', 'OPERATOR', 'CUSTOMER')
  async smartQuery(
    @Body() body: {
      question: string;
      topK?: number;
      customerCode?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
    @Request() req: any,
  ) {
    if (req.user?.role === 'CUSTOMER') {
      if (!body.customerCode) {
        throw new ForbiddenException('客户使用知识库前请先输入客户编号');
      }
      const customer = await this.prisma.customer.findUnique({
        where: { customerCode: body.customerCode },
        select: { id: true },
      });
      if (!customer || customer.id !== req.user.customerId) {
        throw new ForbiddenException('客户编号校验失败，无法使用知识库');
      }
    }
    return this.kbService.smartQuery(body.question, body.topK, body.history);
  }

  @Post('ai-search/quick')
  @Roles('ENGINEER', 'ADMIN', 'OPERATOR', 'CUSTOMER')
  async aiSearchQuick(
    @Body() body: { query: string; customerCode?: string },
    @Request() req: any,
  ) {
    if (!body.query?.trim()) {
      throw new ForbiddenException('query 不能为空');
    }
    if (req.user?.role === 'CUSTOMER') {
      if (!body.customerCode) {
        throw new ForbiddenException('客户使用知识库前请先输入客户编号');
      }
      const customer = await this.prisma.customer.findUnique({
        where: { customerCode: body.customerCode },
        select: { id: true },
      });
      if (!customer || customer.id !== req.user.customerId) {
        throw new ForbiddenException('客户编号校验失败，无法使用知识库');
      }
    }
    return this.kbService.aiSearch(body.query.trim(), 'quick');
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

  @Post('chat')
  @Roles('ENGINEER', 'ADMIN', 'OPERATOR', 'CUSTOMER')
  async chat(
    @Body()     body: {
      sessionId?: string;
      message: string;
      customerCode?: string;
      searchMode?: 'internal' | 'hybrid';
      aiSearchDepth?: 'quick' | 'deep';
      useSandbox?: boolean;
      requestExample?: string;
    },
    @Request() req: any,
  ) {
    if (!body.message?.trim()) {
      throw new ForbiddenException('消息不能为空');
    }
    if (req.user?.role === 'CUSTOMER') {
      if (!body.customerCode) {
        throw new ForbiddenException('客户使用知识库前请先输入客户编号');
      }
      const customer = await this.prisma.customer.findUnique({
        where: { customerCode: body.customerCode },
        select: { id: true },
      });
      if (!customer || customer.id !== req.user.customerId) {
        throw new ForbiddenException('客户编号校验失败，无法使用知识库');
      }
    }
    return this.kbService.chat({
      sessionId: body.sessionId,
      userId: req.user.id,
      userRole: req.user.role,
      customerCode: body.customerCode,
      message: body.message.trim(),
      searchMode: body.searchMode,
      aiSearchDepth: body.aiSearchDepth,
      useSandbox: body.useSandbox,
      requestExample: body.requestExample?.trim(),
    });
  }

  /** SSE：内部知识库仍单次请求；主模型 token 流式；AI 搜索在配置 AI_SEARCH_SSE_PATH 时可 SSE，否则仅状态 + 单次 JSON */
  @Post('chat/stream')
  @Roles('ENGINEER', 'ADMIN', 'OPERATOR', 'CUSTOMER')
  async chatStream(
    @Body()
    body: {
      sessionId?: string;
      message: string;
      customerCode?: string;
      searchMode?: 'internal' | 'hybrid';
      aiSearchDepth?: 'quick' | 'deep';
      useSandbox?: boolean;
      requestExample?: string;
    },
    @Req() req: any,
    @Res({ passthrough: false }) res: Response,
  ) {
    if (!body.message?.trim()) {
      res.status(400).json({ message: '消息不能为空' });
      return;
    }
    if (req.user?.role === 'CUSTOMER') {
      if (!body.customerCode) {
        res.status(403).json({ message: '客户使用知识库前请先输入客户编号' });
        return;
      }
      const customer = await this.prisma.customer.findUnique({
        where: { customerCode: body.customerCode },
        select: { id: true },
      });
      if (!customer || customer.id !== req.user.customerId) {
        res.status(403).json({ message: '客户编号校验失败，无法使用知识库' });
        return;
      }
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as any).flushHeaders?.();

    const flush = () => {
      const r = res as any;
      if (typeof r.flush === 'function') r.flush();
    };

    try {
      for await (const chunk of this.kbService.chatStream({
        sessionId: body.sessionId,
        userId: req.user.id,
        userRole: req.user.role,
        customerCode: body.customerCode,
        message: body.message.trim(),
        searchMode: body.searchMode,
        aiSearchDepth: body.aiSearchDepth,
        useSandbox: body.useSandbox,
        requestExample: body.requestExample?.trim(),
      })) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        flush();
      }
    } catch (e: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e?.message || '流式输出失败' })}\n\n`);
    }
    res.end();
  }

  @Get('chat/sessions/list')
  @Roles('ENGINEER', 'ADMIN', 'OPERATOR', 'CUSTOMER')
  getChatSessions(@Request() req: any) {
    return this.kbService.getUserSessions(req.user.id);
  }

  @Get('chat/:sessionId')
  @Roles('ENGINEER', 'ADMIN', 'OPERATOR', 'CUSTOMER')
  getChatHistory(@Param('sessionId') sessionId: string, @Request() req: any) {
    return this.kbService.getSessionMessages(sessionId, req.user.id);
  }
}
