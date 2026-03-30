import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CustomerLoginDto, StaffLoginDto, RefreshTokenDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('customer-login')
  customerLogin(@Body() dto: CustomerLoginDto) {
    return this.authService.customerLogin(dto.customerCode);
  }

  @Post('staff-login')
  staffLogin(@Body() dto: StaffLoginDto) {
    return this.authService.staffLogin(dto.username, dto.password);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }
}
