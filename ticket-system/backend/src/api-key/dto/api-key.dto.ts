import { IsString, IsArray, IsBoolean, IsOptional, IsDateString, ArrayNotEmpty, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  allowedModules!: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  allowedModules?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
