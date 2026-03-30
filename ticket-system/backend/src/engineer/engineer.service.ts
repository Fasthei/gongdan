import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEngineerDto, UpdateAvailabilityDto, UpdateEngineerEmailDto } from './dto/engineer.dto';
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
