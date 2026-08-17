import { z } from 'zod';
import { phoneSchema } from './common.js';

/**
 * Consulta de saldo pelo telefone, feita pelo checkout.
 *
 * Usa o mesmo phoneSchema do cadastro: telefone completo com DDD,
 * normalizado para so digitos. Exigir o numero inteiro e parte do que
 * torna caro varrer a base — ver o comentario na rota.
 */
export const cashbackBalanceQuerySchema = z.object({
  phone: phoneSchema,
});
export type CashbackBalanceQuery = z.infer<typeof cashbackBalanceQuerySchema>;

/* ---------------- Formato das respostas ---------------- */

export interface CashbackBalance {
  saldoCents: number;
  saldoFormatted: string;
  /** Teto de quanto de um pedido pode ser pago com cashback. */
  maxRedeemPercent: number;
  proximoVencimento: { amountCents: number; expiresAt: string } | null;
}

export interface ClienteComCashback {
  customerId: string;
  name: string | null;
  phone: string;
  saldoCents: number;
  saldoFormatted: string;
  proximoVencimento: string | null;
  vencendoCents: number;
}

export interface ResumoDeCashback {
  totalEmAbertoCents: number;
  totalEmAbertoFormatted: string;
  clientesComSaldo: number;
  vencendoEmBreveCents: number;
  vencendoEmBreveFormatted: string;
  clientes: ClienteComCashback[];
}
