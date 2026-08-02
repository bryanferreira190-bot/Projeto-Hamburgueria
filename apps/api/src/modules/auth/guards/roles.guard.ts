import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasRoleLevel, type AdminRole } from '@adventure/shared';
import { ROLES_KEY } from '../decorators';
import type { AccessTokenPayload } from '../token.service';

/**
 * Autorizacao por papel, hierarquica.
 *
 * A hierarquia (DELIVERY < KITCHEN < MANAGER < OWNER) vive em
 * @adventure/shared, entao a API e o painel enxergam exatamente as mesmas
 * regras — o painel esconde o botao e a API recusa a chamada.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ admin?: AccessTokenPayload }>();
    const admin = request.admin;

    if (!admin || !hasRoleLevel(admin.role, required)) {
      throw new ForbiddenException('Voce nao tem permissao para esta operacao');
    }

    return true;
  }
}
