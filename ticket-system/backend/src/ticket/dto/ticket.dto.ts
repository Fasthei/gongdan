import { IsString, IsNotEmpty, IsEnum, IsOptional, IsArray } from 'class-validator';

export enum PlatformEnum { taiji = 'taiji', xm = 'xm', original = 'original' }
export enum NetworkEnvEnum { local = 'local', cloud = 'cloud' }
export enum EngineerLevelEnum { L1 = 'L1', L2 = 'L2', L3 = 'L3' }
export enum AssistancePhaseEnum { PRESALES = 'PRESALES', POSTSALES = 'POSTSALES' }

export class CreateTicketDto {
  @IsEnum(PlatformEnum, { message: '平台类型必须是 taiji、xm 或 original' })
  platform: PlatformEnum;

  @IsString()
  @IsNotEmpty({ message: '账号信息不能为空' })
  accountInfo: string;

  @IsString()
  @IsNotEmpty({ message: '使用的模型不能为空' })
  modelUsed: string;

  @IsString()
  @IsNotEmpty({ message: '问题描述不能为空' })
  description: string;

  @IsString()
  @IsNotEmpty({ message: '请求示例不能为空' })
  requestExample: string;

  @IsOptional()
  @IsString()
  contactInfo?: string;

  @IsOptional()
  @IsString()
  framework?: string;

  @IsOptional()
  @IsEnum(NetworkEnvEnum)
  networkEnv?: NetworkEnvEnum;

  @IsOptional()
  @IsArray()
  attachmentUrls?: string[];

  @IsOptional()
  @IsEnum(EngineerLevelEnum)
  requestedLevel?: EngineerLevelEnum;

  /** 售前协助 / 售后协助；不传则默认售后（兼容旧客户端） */
  @IsOptional()
  @IsEnum(AssistancePhaseEnum)
  assistancePhase?: AssistancePhaseEnum;
}

export class TicketFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsEnum(AssistancePhaseEnum)
  assistancePhase?: AssistancePhaseEnum;

  @IsOptional()
  page?: number;

  @IsOptional()
  pageSize?: number;
}
