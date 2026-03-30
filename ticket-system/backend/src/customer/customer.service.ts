import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateCustomerCode, getSlaConfig } from '../common/utils';
import { CreateCustomerDto, UpdateCustomerTierDto } from './dto/customer.dto';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCustomerDto, operatorId: string) {
    const tier = dto.tier || 'NORMAL';
    const sla = getSlaConfig(tier as any);
    let customerCode: string;
    let attempts = 0;

    // 确保唯一性
    do {
      customerCode = generateCustomerCode();
      const existing = await this.prisma.customer.findUnique({ where: { customerCode } });
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    return this.prisma.customer.create({
      data: {
        customerCode,
        name: dto.name,
        tier: tier as any,
        firstResponseHours: sla.firstResponseHours,
        resolutionHours: sla.resolutionHours,
        queueType: sla.queueType,
        createdBy: operatorId,
      },
    });
  }

  async updateTier(customerId: string, dto: UpdateCustomerTierDto, operatorId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');

    const sla = getSlaConfig(dto.tier as any);
    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        tier: dto.tier as any,
        firstResponseHours: sla.firstResponseHours,
        resolutionHours: sla.resolutionHours,
        queueType: sla.queueType,
      },
    });
  }

  async bindEngineer(customerId: string, engineerId: string, operatorId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');
    const engineer = await this.prisma.engineer.findUnique({ where: { id: engineerId } });
    if (!engineer) throw new NotFoundException('工程师不存在');

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { boundEngineerId: engineerId },
    });
  }

  async findAll() {
    return this.prisma.customer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('客户不存在');
    return customer;
  }

  async findByCode(customerCode: string) {
    const customer = await this.prisma.customer.findUnique({ where: { customerCode } });
    if (!customer) throw new NotFoundException('客户编号无效');
    return customer;
  }
}
