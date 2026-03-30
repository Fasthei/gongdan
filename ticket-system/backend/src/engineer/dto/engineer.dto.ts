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

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}

export class UpdateAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;
}

export class UpdateEngineerEmailDto {
  @IsEmail()
  email: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  oldPassword: string;

  @IsString()
  @IsNotEmpty()
  newPassword: string;
}

export class CreateOperatorDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class AdminUpdateEngineerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(EngineerLevelEnum)
  level?: EngineerLevelEnum;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class AdminResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}

export class AdminUpdateOperatorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
