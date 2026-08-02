import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminRole } from '@adventure/shared';
import type { AccessTokenPayload } from './token.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'requiredRole';
export const ALLOW_TOTP_SETUP_KEY = 'allowTotpSetup';

/**
 * Marca a rota como aberta.
 *
 * O guard e global e o padrao e exigir autenticacao. Assim, esquecer o
 * decorator deixa a rota fechada — falha para o lado seguro.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Papel minimo exigido. Papeis superiores tambem passam. */
export const RequireRole = (role: AdminRole) => SetMetadata(ROLES_KEY, role);

/**
 * Aceita tambem o token de escopo restrito emitido quando o usuario precisa
 * configurar o 2FA obrigatorio antes do primeiro acesso.
 *
 * Sem isto, OWNER e MANAGER ficariam presos: o 2FA e exigido para entrar,
 * mas so da para configura-lo estando dentro.
 */
export const AllowTotpSetup = () => SetMetadata(ALLOW_TOTP_SETUP_KEY, true);

/** Injeta o admin autenticado no handler. */
export const CurrentAdmin = createParamDecorator(
  (data: keyof AccessTokenPayload | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ admin?: AccessTokenPayload }>();
    const admin = request.admin;
    return data && admin ? admin[data] : admin;
  },
);
