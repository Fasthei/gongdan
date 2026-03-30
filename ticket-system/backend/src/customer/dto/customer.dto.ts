import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

export enum CustomerTierEnum {
  NORMAL = 'NORMAL',
  KEY = 'KEY',
  EXCLUSIVE = 'EXCLUSIVE',
}

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty({ message: '客户名称不能为空' })
  name: string;

  @IsEnum(CustomerTierEnum)
  @IsOptional()
  tier?: CustomerTierEnum;
}

export class UpdateCustomerTierDto {
  @IsEnum(CustomerTierEnum)
  tier: CustomerTierEnum;
}

export class BindEngineerDto {
  @IsString()
  @IsNotEmpty()
  engineerId: string;
}
