import { Injectable } from '@nestjs/common';
import { formatBRL } from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CashbackService } from './cashback.service';

export interface ClienteComCashback {
  customerId: string;
  name: string | null;
  phone: string;
  saldoCents: number;
  saldoFormatted: string;
  /** Data do credito que vence primeiro — e o que a loja quer ver. */
  proximoVencimento: string | null;
  /** Quanto vence nesse proximo vencimento. */
  vencendoCents: number;
}

export interface ResumoDeCashback {
  /** Quanto a loja "deve" em cashback ainda valido. */
  totalEmAbertoCents: number;
  totalEmAbertoFormatted: string;
  clientesComSaldo: number;
  /** Quanto vence nos proximos 3 dias — o que exige acao comercial. */
  vencendoEmBreveCents: number;
  vencendoEmBreveFormatted: string;
  clientes: ClienteComCashback[];
}

const DIAS_DE_ALERTA = 3;

@Injectable()
export class CashbackAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashback: CashbackService,
  ) {}

  /**
   * Saldo para o checkout — so numeros, sem dado pessoal nenhum.
   *
   * Ver o comentario na rota publica em cashback.controller.ts sobre por
   * que nada alem de valores sai daqui.
   */
  async saldoPublicoPorTelefone(phone: string) {
    const store = await this.prisma.store.findFirst({
      select: { id: true, cashbackMaxRedeemPercent: true },
    });
    if (!store) return { saldoCents: 0, saldoFormatted: formatBRL(0), maxRedeemPercent: 0 };

    const saldo = await this.cashback.saldoPorTelefone(store.id, phone);

    return {
      saldoCents: saldo.totalCents,
      saldoFormatted: formatBRL(saldo.totalCents),
      /* O checkout precisa para mostrar "voce pode usar ate X neste
         pedido" sem ter que saber a regra da loja. */
      maxRedeemPercent: store.cashbackMaxRedeemPercent,
      proximoVencimento: saldo.proximoVencimento
        ? {
            amountCents: saldo.proximoVencimento.amountCents,
            expiresAt: saldo.proximoVencimento.expiresAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * Todos os clientes com saldo, do maior para o menor.
   *
   * Agregado em UMA query com groupBy, e nao um saldo por cliente em
   * loop: a lista cresce com a base de clientes, e uma consulta por
   * linha degradaria rapido conforme o programa pega.
   */
  async listarClientesComSaldo(): Promise<ResumoDeCashback> {
    const agora = new Date();

    const creditos = await this.prisma.cashbackCredit.findMany({
      where: { expiresAt: { gt: agora }, remainingCents: { gt: 0 } },
      select: {
        customerId: true,
        remainingCents: true,
        expiresAt: true,
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { expiresAt: 'asc' },
    });

    const limiteDeAlerta = new Date(agora);
    limiteDeAlerta.setDate(limiteDeAlerta.getDate() + DIAS_DE_ALERTA);

    const porCliente = new Map<string, ClienteComCashback>();
    let vencendoEmBreveCents = 0;

    for (const credito of creditos) {
      if (credito.expiresAt <= limiteDeAlerta) {
        vencendoEmBreveCents += credito.remainingCents;
      }

      const atual = porCliente.get(credito.customerId);

      if (atual) {
        atual.saldoCents += credito.remainingCents;
        atual.saldoFormatted = formatBRL(atual.saldoCents);
        continue;
      }

      /* Como a lista ja vem ordenada por expiresAt, o PRIMEIRO credito de
         cada cliente e justamente o que vence antes. */
      porCliente.set(credito.customerId, {
        customerId: credito.customerId,
        name: credito.customer.name,
        phone: credito.customer.phone,
        saldoCents: credito.remainingCents,
        saldoFormatted: formatBRL(credito.remainingCents),
        proximoVencimento: credito.expiresAt.toISOString(),
        vencendoCents: credito.remainingCents,
      });
    }

    const clientes = [...porCliente.values()].sort((a, b) => b.saldoCents - a.saldoCents);
    const totalEmAbertoCents = clientes.reduce((soma, cliente) => soma + cliente.saldoCents, 0);

    return {
      totalEmAbertoCents,
      totalEmAbertoFormatted: formatBRL(totalEmAbertoCents),
      clientesComSaldo: clientes.length,
      vencendoEmBreveCents,
      vencendoEmBreveFormatted: formatBRL(vencendoEmBreveCents),
      clientes,
    };
  }
}
