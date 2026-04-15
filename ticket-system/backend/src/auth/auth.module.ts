import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { CasdoorService } from './casdoor.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
  ],
  providers: [AuthService, JwtStrategy, CasdoorService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
