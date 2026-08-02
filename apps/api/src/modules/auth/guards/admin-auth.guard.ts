import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_TOTP_SETUP_KEY, IS_PUBLIC_KEY } from '../decorators';
import { TokenService, type AccessTokenPayload } from '../token.service';

/**
 * Guard global de autenticacao.
 *
 * Fecha tudo por padrao: uma rota so fica aberta se declarar @Public().
 * Esquecer o decorator resulta em rota protegida, e nao em rota exposta.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { admin?: AccessTokenPayload }>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Autenticacao obrigatoria');
    }

    /* Rotas de configuracao de 2FA aceitam tambem o token de escopo restrito,
       emitido a quem ainda nao pode obter um access token completo. */
    const allowsSetup = this.reflector.getAllAndOverride<boolean>(ALLOW_TOTP_SETUP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (allowsSetup) {
      try {
        const setup = this.tokens.verifyTotpSetupToken(token);
        request.admin = { ...setup, type: 'access' };
        return true;
      } catch {
        /* Nao era token de setup: segue para a validacao normal. */
      }
    }

    request.admin = this.tokens.verifyAccessToken(token);
    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
