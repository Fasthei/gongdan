import { IsBoolean, IsOptional, IsString, ValidateNested, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateModuleEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

export class BatchModuleUpdateItemDto {
  @IsString()
  moduleKey!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class BatchUpdateModulesDto {
  @ValidateNested({ each: true })
  @Type(() => BatchModuleUpdateItemDto)
  @ArrayNotEmpty()
  modules!: BatchModuleUpdateItemDto[];
}

