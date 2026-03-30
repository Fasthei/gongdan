import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'default-secret',
    });
  }

  async validate(payload: any) {
    if (!payload.sub || !payload.role) throw new UnauthorizedException();
    return {
      id: payload.sub,
      role: payload.role,
      customerId: payload.customerId,
      engineerLevel: payload.engineerLevel,
    };
  }
}
