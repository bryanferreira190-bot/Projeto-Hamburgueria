import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, TokenService, TotpService],
  exports: [TokenService],
})
export class AuthModule {}
