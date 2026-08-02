import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  adminEnableTotpSchema,
  adminLoginSchema,
  adminTotpLoginSchema,
  changePasswordSchema,
  type AdminEnableTotpInput,
  type AdminLoginInput,
  type AdminTotpLoginInput,
  type ChangePasswordInput,
} from '@adventure/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AdminAuthService, type AdminSummary, type LoginResult } from './admin-auth.service';
import { AllowTotpSetup, CurrentAdmin, Public } from './decorators';
import { TokenService, parseDuration, type IssuedTokens } from './token.service';

const REFRESH_COOKIE = 'adventure_refresh';

/**
 * O refresh token NAO aparece aqui de proposito: ele viaja apenas no cookie
 * httpOnly, fora do alcance do JavaScript do cliente.
 */
type LoginResponse =
  | { status: 'TOTP_REQUIRED'; challengeToken: string }
  | { status: 'TOTP_SETUP_REQUIRED'; setupToken: string }
  | { status: 'AUTHENTICATED'; admin: AdminSummary; accessToken: string; expiresIn: number };

@Controller('auth/admin')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly tokens: TokenService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Limite proprio e bem mais rigido que o global: login e o alvo classico
   * de forca bruta e de teste de credenciais vazadas.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: AdminLoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(body, readDevice(request));
    return this.respondWithTokens(result, response);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login/totp')
  @HttpCode(HttpStatus.OK)
  async loginTotp(
    @Body(new ZodValidationPipe(adminTotpLoginSchema)) body: AdminTotpLoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.loginWithTotp(
      body.challengeToken,
      body.code,
      readDevice(request),
    );
    return this.respondWithTokens(result, response);
  }

  /** Troca o refresh por um par novo. O antigo e queimado no processo. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const raw = readRefreshCookie(request);
    if (!raw) {
      throw new UnauthorizedException('Sessao nao encontrada');
    }

    const tokens = await this.tokens.rotateRefreshToken(raw, readDevice(request));
    this.setRefreshCookie(response, tokens);

    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const raw = readRefreshCookie(request);
    if (raw) await this.tokens.revokeToken(raw);

    response.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth/admin' });
  }

  @Get('me')
  me(@CurrentAdmin('sub') adminId: string) {
    return this.auth.getProfile(adminId);
  }

  /* Aceitam o token de escopo restrito, para quebrar o impasse do 2FA
     obrigatorio no primeiro acesso. */
  @AllowTotpSetup()
  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  startTotp(@CurrentAdmin('sub') adminId: string) {
    return this.auth.startTotpSetup(adminId);
  }

  @AllowTotpSetup()
  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  enableTotp(
    @CurrentAdmin('sub') adminId: string,
    @Body(new ZodValidationPipe(adminEnableTotpSchema)) body: AdminEnableTotpInput,
  ) {
    return this.auth.confirmTotpSetup(adminId, body.code);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentAdmin('sub') adminId: string,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    return this.auth.changePassword(adminId, body);
  }

  private respondWithTokens(result: LoginResult, response: Response): LoginResponse {
    if (result.status === 'TOTP_REQUIRED') {
      return { status: 'TOTP_REQUIRED', challengeToken: result.challengeToken };
    }

    if (result.status === 'TOTP_SETUP_REQUIRED') {
      return { status: 'TOTP_SETUP_REQUIRED', setupToken: result.setupToken };
    }

    this.setRefreshCookie(response, result.tokens);

    /* O access token vai no corpo para ficar apenas em memoria no cliente.
       Guardar em localStorage o exporia a qualquer XSS. */
    return {
      status: 'AUTHENTICATED',
      admin: result.admin,
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
    };
  }

  /**
   * O refresh vive em cookie httpOnly: JavaScript nao le, o que neutraliza
   * o roubo por XSS. SameSite=strict cobre CSRF, e o Secure so relaxa em
   * desenvolvimento, onde nao ha HTTPS.
   */
  private setRefreshCookie(response: Response, tokens: IssuedTokens): void {
    response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth/admin',
      maxAge: parseDuration(this.env.JWT_REFRESH_TTL),
    });
  }
}

function readRefreshCookie(request: Request): string | null {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[REFRESH_COOKIE] ?? null;
}

function readDevice(request: Request) {
  return {
    userAgent: request.headers['user-agent'],
    ipAddress: request.ip,
  };
}
