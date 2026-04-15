import { IsString, IsNotEmpty } from 'class-validator';

export class CustomerLoginDto {
  @IsString()
  @IsNotEmpty({ message: '客户编号不能为空' })
  customerCode: string;
}

export class StaffLoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class LogoutDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class CasdoorCallbackDto {
  @IsString()
  @IsNotEmpty({ message: 'Casdoor code 不能为空' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'Casdoor state 不能为空' })
  state: string;
}
