import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTicketDto } from './dto/ticket.dto';
import { validateTransition, getTimestampUpdates } from './ticket-state-machine';
import { calculateSlaDeadline, generateTicketNumber } from '../common/utils';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class TicketService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  // 工单内容不可变字段列表
  private readonly IMMUTABLE_FIELDS = ['platform', 'accountInfo', 'modelUsed', 'description', 'requestExample'];

  // 每日工单上限（普通客户）
  private readonly DAILY_TICKET_LIMIT = 10;

  private async checkDailyLimit(customerId: string, tier: string) {
    if (tier !== 'NORMAL') return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const count = await this.prisma.ticket.count({
      where: {
        customerId,
        createdAt: { gte: today },
      },
    });
    if (count >= this.DAILY_TICKET_LIMIT) {
      throw new BadRequestException(
        `普通客户每日最多创建 ${this.DAILY_TICKET_LIMIT} 个工单，今日已提交 ${count} 个，请明日再试或升级账户等级`,
      );
    }
  }

  async create(dto: CreateTicketDto, creatorId: string, creatorRole: 'CUSTOMER' | 'OPERATOR') {
    let customerId = creatorId;
    if (creatorRole === 'OPERATOR') {
      throw new BadRequestException('运营发起工单需指定客户ID，请使用 createForCustomer 接口');
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');
    if (customer.tier === 'NORMAL' && dto.requestedLevel) {
      throw new BadRequestException('普通客户不支持选择支持工程师等级');
    }
    await this.checkDailyLimit(customerId, customer.tier);

    const slaDeadline = calculateSlaDeadline(customer.tier as any, new Date());
    const ticketNumber = generateTicketNumber();
    const priority = customer.tier === 'EXCLUSIVE' ? 'EXCLUSIVE' : customer.tier === 'KEY' ? 'PRIORITY' : 'NORMAL';

    const createdTicket = await this.prisma.ticket.create({
      data: {
        ticketNumber,
        customerId,
        createdBy: creatorId,
        createdByRole: creatorRole,
        status: 'PENDING',
        priority: priority as any,
        platform: dto.platform as any,
        accountInfo: dto.accountInfo,
        modelUsed: dto.modelUsed,
        description: dto.description,
        requestExample: dto.requestExample,
        contactInfo: dto.contactInfo,
        framework: dto.framework,
        networkEnv: dto.networkEnv as any,
        attachmentUrls: dto.attachmentUrls || [],
        slaDeadline,
        engineerLevel: dto.requestedLevel as any,
      },
      include: { customer: { select: { name: true, tier: true } } },
    });

    await this.notificationService.publishEvent({
      type: 'ticket.created',
      ticketId: createdTicket.id,
      ticketNumber: createdTicket.ticketNumber,
      payload: {
        customerId: createdTicket.customerId,
        createdByRole: createdTicket.createdByRole,
        priority: createdTicket.priority,
      },
    });

    return createdTicket;
  }

  async createForCustomer(dto: CreateTicketDto, customerId: string, operatorId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');
    if (customer.tier === 'NORMAL' && dto.requestedLevel) {
      throw new BadRequestException('普通客户不支持选择支持工程师等级');
    }
    await this.checkDailyLimit(customerId, customer.tier);

    const slaDeadline = calculateSlaDeadline(customer.tier as any, new Date());
    const ticketNumber = generateTicketNumber();
    const priority = customer.tier === 'EXCLUSIVE' ? 'EXCLUSIVE' : customer.tier === 'KEY' ? 'PRIORITY' : 'NORMAL';

    const createdTicket = await this.prisma.ticket.create({
      data: {
        ticketNumber,
        customerId,
        createdBy: operatorId,
        createdByRole: 'OPERATOR',
        status: 'PENDING',
        priority: priority as any,
        platform: dto.platform as any,
        accountInfo: dto.accountInfo,
        modelUsed: dto.modelUsed,
        description: dto.description,
        requestExample: dto.requestExample,
        contactInfo: dto.contactInfo,
        framework: dto.framework,
        networkEnv: dto.networkEnv as any,
        attachmentUrls: dto.attachmentUrls || [],
        slaDeadline,
        engineerLevel: dto.requestedLevel as any,
      },
    });

    await this.notificationService.publishEvent({
      type: 'ticket.created',
      ticketId: createdTicket.id,
      ticketNumber: createdTicket.ticketNumber,
      payload: {
        customerId: createdTicket.customerId,
        createdByRole: createdTicket.createdByRole,
        priority: createdTicket.priority,
      },
    });

    return createdTicket;
  }

  async findAll(user: any, page = 1, pageSize = 20, status?: string) {
    const take = Math.min(pageSize, 100);
    const skip = (page - 1) * take;
    const where: any = {};

    if (status) where.status = status;

    if (user.role === 'CUSTOMER') {
      where.customerId = user.customerId;
    } else if (user.role === 'OPERATOR') {
      // 运营仅可查看其创建的客户名下工单（customer.createdBy = operatorId）。
      where.customer = { createdBy: user.id };
    }
    // ENGINEER / ADMIN 看全部

    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        skip,
        take,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: { select: { name: true, tier: true, customerCode: true } },
          assignedEngineer: { select: { username: true, level: true } },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { tickets, total, page, pageSize: take, totalPages: Math.ceil(total / take) };
  }

  async findOne(ticketId: string, user: any) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        customer: { select: { name: true, tier: true, customerCode: true, createdBy: true } },
        assignedEngineer: { select: { username: true, level: true, email: true } },
        urges: { orderBy: { urgedAt: 'desc' } },
      },
    });
    if (!ticket) throw new NotFoundException('工单不存在');

    if (user.role === 'CUSTOMER' && ticket.customerId !== user.customerId) {
      throw new ForbiddenException('无权查看此工单');
    }
    if (user.role === 'OPERATOR' && ticket.customer?.createdBy !== user.id) {
      throw new ForbiddenException('无权查看此工单');
    }

    return ticket;
  }

  async updateStatus(ticketId: string, newStatus: string, user: any) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('工单不存在');

    validateTransition(ticket as any, newStatus as any, user);
    const timestamps = getTimestampUpdates(newStatus as any);

    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: newStatus as any, ...timestamps },
    });
  }

  async assignEngineer(ticketId: string, engineerId: string, operatorId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: true },
    });
    if (!ticket) throw new NotFoundException('工单不存在');

    const engineer = await this.prisma.engineer.findUnique({ where: { id: engineerId } });
    if (!engineer) throw new NotFoundException('工程师不存在');
    if (!engineer.isAvailable) throw new BadRequestException('该工程师当前不可用');

    if (ticket.customer.tier === 'EXCLUSIVE' && engineer.level === 'L1') {
      throw new BadRequestException('专属客户工单需要 L2 或以上级别工程师');
    }

    validateTransition(ticket as any, 'ACCEPTED', { id: operatorId, role: 'OPERATOR' });

    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assignedEngineerId: engineerId,
        engineerLevel: engineer.level,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        firstResponseAt: new Date(),
      },
      include: { assignedEngineer: { select: { username: true, level: true } } },
    });
  }

  async requestClose(ticketId: string, engineerId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('工单不存在');
    if (ticket.assignedEngineerId !== engineerId) throw new ForbiddenException('只有负责工程师可申请关闭');

    validateTransition(ticket as any, 'PENDING_CLOSE', { id: engineerId, role: 'ENGINEER' });

    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'PENDING_CLOSE', closeRequestedAt: new Date(), closeRequestedBy: engineerId },
    });
  }

  async approveClose(ticketId: string, operatorId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('工单不存在');
    if (ticket.status !== 'PENDING_CLOSE') throw new BadRequestException('工单不在待关闭状态');

    const closedTicket = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'CLOSED', closedAt: new Date(), closeApprovedAt: new Date(), closeApprovedBy: operatorId },
    });

    await this.notificationService.publishEvent({
      type: 'ticket.closed',
      ticketId: closedTicket.id,
      ticketNumber: closedTicket.ticketNumber,
      payload: {
        approvedBy: operatorId,
        customerId: closedTicket.customerId,
      },
    });

    return closedTicket;
  }

  async rejectClose(ticketId: string, operatorId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('工单不存在');
    if (ticket.status !== 'PENDING_CLOSE') throw new BadRequestException('工单不在待关闭状态');
    validateTransition(ticket as any, 'IN_PROGRESS', { id: operatorId, role: 'OPERATOR' });

    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'IN_PROGRESS', closeRequestedAt: null, closeRequestedBy: null },
    });
  }

  async urge(ticketId: string, operatorId: string, note?: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('工单不存在');

    return this.prisma.ticketUrge.create({
      data: { ticketId, urgedBy: operatorId, note },
    });
  }

  // ─── 工单留言板 ───────────────────────────────────────────────────────

  async getMessages(ticketId: string, user: any) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: { select: { createdBy: true } } },
    });
    if (!ticket) throw new NotFoundException('工单不存在');

    // 客户只能查看自己工单的留言
    if (user.role === 'CUSTOMER' && ticket.customerId !== user.id) {
      throw new ForbiddenException('无权查看此工单留言');
    }
    if (user.role === 'OPERATOR' && ticket.customer?.createdBy !== user.id) {
      throw new ForbiddenException('无权查看此工单留言');
    }
    if (user.role === 'ENGINEER' && ticket.assignedEngineerId && ticket.assignedEngineerId !== user.id) {
      throw new ForbiddenException('无权查看此工单留言');
    }

    return this.prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMessage(ticketId: string, content: string, user: any, attachmentUrls?: string[]) {
    if (!content?.trim()) throw new BadRequestException('留言内容不能为空');

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { customer: { select: { createdBy: true } } },
    });
    if (!ticket) throw new NotFoundException('工单不存在');

    // 客户只能在自己工单留言
    if (user.role === 'CUSTOMER' && ticket.customerId !== user.id) {
      throw new ForbiddenException('无权在此工单留言');
    }
    if (user.role === 'OPERATOR' && ticket.customer?.createdBy !== user.id) {
      throw new ForbiddenException('无权在此工单留言');
    }
    if (user.role === 'ENGINEER' && ticket.assignedEngineerId && ticket.assignedEngineerId !== user.id) {
      throw new ForbiddenException('无权在此工单留言');
    }

    // 已关闭工单只允许工程师和运营留言
    if (ticket.status === 'CLOSED' && user.role === 'CUSTOMER') {
      throw new BadRequestException('工单已关闭，客户无法继续留言');
    }

    const roleMap: Record<string, string> = {
      CUSTOMER: 'CUSTOMER',
      ENGINEER: 'ENGINEER',
      ADMIN: 'ENGINEER',
      OPERATOR: 'OPERATOR',
    };

    const safeAttachmentUrls = Array.isArray(attachmentUrls)
      ? attachmentUrls
          .map((x) => String(x || '').trim())
          .filter((x) => /^https?:\/\//i.test(x))
          .slice(0, 5)
      : [];

    return this.prisma.ticketMessage.create({
      data: {
        ticketId,
        authorId: user.id,
        authorRole: roleMap[user.role] as any,
        content: content.trim(),
        attachmentUrls: safeAttachmentUrls,
      },
    });
  }

  async deleteMessage(messageId: string, user: any) {
    const msg = await this.prisma.ticketMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('留言不存在');

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: msg.ticketId },
      include: { customer: { select: { createdBy: true } } },
    });
    if (!ticket) throw new NotFoundException('工单不存在');

    // 只能删自己的留言，或管理员/运营可删任意留言
    if (msg.authorId !== user.id && user.role !== 'ADMIN' && user.role !== 'OPERATOR') {
      throw new ForbiddenException('无权删除此留言');
    }
    if (user.role === 'OPERATOR' && ticket.customer?.createdBy !== user.id) {
      throw new ForbiddenException('无权删除此留言');
    }

    await this.prisma.ticketMessage.delete({ where: { id: messageId } });
    return { success: true };
  }

  async getDailyTicketUsage(customerId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const count = await this.prisma.ticket.count({
      where: { customerId, createdAt: { gte: today } },
    });
    return { used: count, limit: this.DAILY_TICKET_LIMIT, remaining: Math.max(0, this.DAILY_TICKET_LIMIT - count) };
  }
}
