import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEngineerDto, UpdateAvailabilityDto, UpdateEngineerEmailDto, ChangePasswordDto, CreateOperatorDto } from './dto/engineer.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class EngineerService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEngineerDto, adminId: string) {
    const existing = await this.prisma.engineer.findUnique({ where: { username: dto.username } });
    if (existing) throw new ConflictException('用户名已存在');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.engineer.create({
      data: {
        username: dto.username,
        email: dto.email,
        passwordHash,
        level: dto.level as any,
        role: dto.isAdmin ? 'ADMIN' : 'ENGINEER',
        createdBy: adminId,
      },
      select: { id: true, username: true, email: true, level: true, role: true, isAvailable: true, createdAt: true },
    });
  }

  async updateAvailability(engineerId: string, dto: UpdateAvailabilityDto) {
    const engineer = await this.prisma.engineer.findUnique({ where: { id: engineerId } });
    if (!engineer) throw new NotFoundException('工程师不存在');
    return this.prisma.engineer.update({
      where: { id: engineerId },
      data: { isAvailable: dto.isAvailable },
      select: { id: true, username: true, isAvailable: true },
    });
  }

  async updateEmail(engineerId: string, dto: UpdateEngineerEmailDto) {
    return this.prisma.engineer.update({
      where: { id: engineerId },
      data: { email: dto.email },
      select: { id: true, username: true, email: true },
    });
  }

  async changePassword(engineerId: string, dto: ChangePasswordDto) {
    const engineer = await this.prisma.engineer.findUnique({ where: { id: engineerId } });
    if (!engineer) throw new NotFoundException('工程师不存在');

    const valid = await bcrypt.compare(dto.oldPassword, engineer.passwordHash);
    if (!valid) throw new ConflictException('旧密码错误');

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.engineer.update({
      where: { id: engineerId },
      data: { passwordHash },
    });
    return { success: true };
  }

  async createOperator(dto: CreateOperatorDto, adminId: string) {
    const existing = await this.prisma.operator.findUnique({ where: { username: dto.username } });
    if (existing) throw new ConflictException('运营用户名已存在');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.operator.create({
      data: {
        username: dto.username,
        email: dto.email,
        passwordHash,
        createdBy: adminId,
      },
      select: { id: true, username: true, email: true, createdAt: true },
    });
  }

  async findAll() {
    return this.prisma.engineer.findMany({
      select: { id: true, username: true, email: true, level: true, role: true, isAvailable: true },
      orderBy: { level: 'asc' },
    });
  }

  async findAvailableByLevel(level: string) {
    return this.prisma.engineer.findMany({
      where: { level: level as any, isAvailable: true },
      include: {
        _count: { select: { assignedTickets: { where: { status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } } } } },
      },
    });
  }
}
