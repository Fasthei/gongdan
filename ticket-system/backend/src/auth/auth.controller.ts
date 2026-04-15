import { Controller, Post, Get, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  CustomerLoginDto,
  StaffLoginDto,
  RefreshTokenDto,
  LogoutDto,
  CasdoorCallbackDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('customer-login')
  customerLogin(@Body() dto: CustomerLoginDto) {
    return this.authService.customerLogin(dto.customerCode);
  }

  /**
   * @deprecated 保留仅用于老工具/紧急兜底。前端统一走 Casdoor。
   */
  @Post('staff-login')
  staffLogin(@Body() dto: StaffLoginDto) {
    return this.authService.staffLogin(dto.username, dto.password);
  }

  /** 前端跳转 Casdoor 前获取授权 URL */
  @Get('staff/casdoor/authorize-url')
  casdoorAuthorizeUrl() {
    return this.authService.getCasdoorAuthorizeUrl();
  }

  /** Casdoor 回调：code 换 token 换 userinfo 换本系统 JWT */
  @Post('staff/casdoor/callback')
  casdoorCallback(@Body() dto: CasdoorCallbackDto) {
    return this.authService.casdoorCallback(dto.code, dto.state);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
