import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminRole, cashbackBalanceQuerySchema, type CashbackBalanceQuery } from '@adventure/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public, RequireRole } from '../auth/decorators';
import { CashbackAdminService } from './cashback-admin.service';

@Controller()
export class CashbackController {
  constructor(private readonly admin: CashbackAdminService) {}

  /**
   * Saldo do cliente, consultado pelo checkout.
   *
   * Publica porque o checkout e de convidado — nao existe login de
   * cliente. Devolve SOMENTE valores, nunca nome ou qualquer outro dado
   * pessoal: assim, mesmo que alguem varra telefones, nao consegue
   * montar uma base de clientes, so descobre saldos avulsos.
   *
   * Throttle apertado pelo mesmo motivo, e telefone completo (11
   * digitos, validado pelo phoneSchema) e o que ja torna a varredura
   * cara. Ver a auditoria de LGPD em DECISOES.md.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('cashback/saldo')
  async saldo(
    @Query(new ZodValidationPipe(cashbackBalanceQuerySchema)) query: CashbackBalanceQuery,
  ) {
    return this.admin.saldoPublicoPorTelefone(query.phone);
  }

  /**
   * Clientes com saldo, para o painel.
   *
   * MANAGER: e informacao comercial (quanto a loja tem de passivo em
   * cashback) e traz telefone de cliente junto.
   */
  @RequireRole(AdminRole.MANAGER)
  @Get('admin/cashback')
  async listar() {
    return this.admin.listarClientesComSaldo();
  }
}
