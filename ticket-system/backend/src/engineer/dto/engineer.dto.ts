import { IsString, IsNotEmpty, IsEnum, IsEmail, IsBoolean, IsOptional } from 'class-validator';

export enum EngineerLevelEnum {
  L1 = 'L1',
  L2 = 'L2',
  L3 = 'L3',
}

export class CreateEngineerDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsEnum(EngineerLevelEnum)
  level: EngineerLevelEnum;
}

export class UpdateAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}

export class UpdateEngineerEmailDto {
  @IsEmail()
  email: string;
}
