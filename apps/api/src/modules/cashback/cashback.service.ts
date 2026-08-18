import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface SaldoDeCashback {
  /** Soma dos creditos ainda dentro da validade. */
  totalCents: number;
  /** Quanto vence no proximo vencimento, e quando. Null se nao ha saldo. */
  proximoVencimento: { amountCents: number; expiresAt: Date } | null;
}

/**
 * REGRAS DO CASHBACK
 *
 * Todos os numeros (percentual, validade, teto de resgate) vivem na
 * tabela `store`, nao aqui — sao regras comerciais, e mudar o percentual
 * nao deveria exigir deploy.
 *
 * Modelo de LOTES (ver CashbackCredit no schema): cada pedido que entra
 * em preparo gera um credito com validade propria. O saldo e a soma do
 * que ainda vale. Gastar consome primeiro o que vence antes, para o
 * cliente nunca perder valor que daria para ter usado.
 */
@Injectable()
export class CashbackService {
  private readonly logger = new Logger(CashbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Saldo utilizavel do cliente AGORA.
   *
   * Filtra por `expiresAt > agora` em vez de confiar no `expiredAt`
   * carimbado pelo job diario: se o job atrasar ou falhar, o saldo
   * continua correto — credito vencido nunca aparece como disponivel,
   * mesmo que ninguem tenha marcado ele ainda.
   */
  async saldoDoCliente(customerId: string): Promise<SaldoDeCashback> {
    const creditos = await this.prisma.cashbackCredit.findMany({
      where: {
        customerId,
        expiresAt: { gt: new Date() },
        remainingCents: { gt: 0 },
      },
      orderBy: { expiresAt: 'asc' },
      select: { remainingCents: true, expiresAt: true },
    });

    const totalCents = creditos.reduce((soma, credito) => soma + credito.remainingCents, 0);
    const primeiro = creditos[0];

    return {
      totalCents,
      proximoVencimento: primeiro
        ? { amountCents: primeiro.remainingCents, expiresAt: primeiro.expiresAt }
        : null,
    };
  }

  /** Saldo pelo telefone — e o que o checkout tem em maos. */
  async saldoPorTelefone(storeId: string, phone: string): Promise<SaldoDeCashback> {
    const customer = await this.prisma.customer.findUnique({
      where: { storeId_phone: { storeId, phone } },
      select: { id: true },
    });

    if (!customer) return { totalCents: 0, proximoVencimento: null };
    return this.saldoDoCliente(customer.id);
  }

  /**
   * Quanto deste pedido pode, no maximo, ser pago com cashback.
   *
   * E o menor entre o saldo do cliente e o teto configurado da loja. O
   * teto existe para todo pedido continuar trazendo dinheiro novo — sem
   * ele, um pedido inteiro sairia pago so com saldo acumulado.
   */
  calcularResgateMaximo(
    subtotalCents: number,
    saldoCents: number,
    maxRedeemPercent: number,
  ): number {
    const teto = Math.floor((subtotalCents * maxRedeemPercent) / 100);
    return Math.max(0, Math.min(saldoCents, teto));
  }

  /**
   * Consome cashback do cliente, dentro da transacao de criacao do
   * pedido.
   *
   * FIFO por vencimento: gasta primeiro o credito que expira antes.
   * Roda DENTRO da transacao do pedido de proposito — se a criacao do
   * pedido falhar depois, o saldo consumido volta junto no rollback, em
   * vez de sumir sem pedido nenhum para mostrar.
   *
   * Devolve quanto foi realmente consumido, que pode ser menor que o
   * pedido caso o saldo tenha mudado no meio do caminho.
   */
  async consumir(
    tx: Prisma.TransactionClient,
    customerId: string,
    valorCents: number,
  ): Promise<number> {
    if (valorCents <= 0) return 0;

    const creditos = await tx.cashbackCredit.findMany({
      where: {
        customerId,
        expiresAt: { gt: new Date() },
        remainingCents: { gt: 0 },
      },
      orderBy: { expiresAt: 'asc' },
      select: { id: true, remainingCents: true },
    });

    let restante = valorCents;

    for (const credito of creditos) {
      if (restante <= 0) break;

      const usar = Math.min(credito.remainingCents, restante);

      /* WHERE com o remainingCents esperado: se outro pedido do mesmo
         cliente consumiu este credito em paralelo, o update nao encontra
         a linha e o saldo nao fica negativo. */
      const alterado = await tx.cashbackCredit.updateMany({
        where: { id: credito.id, remainingCents: credito.remainingCents },
        data: { remainingCents: credito.remainingCents - usar },
      });

      if (alterado.count === 1) restante -= usar;
    }

    return valorCents - restante;
  }

  /**
   * Credita o cashback de um pedido.
   *
   * Chamado quando o pedido entra em PREPARO — antes da entrega, de
   * proposito, para o cliente ver o saldo crescer logo depois de pedir,
   * nao so depois de receber. O preco (subtotal, desconto, cashback
   * usado) ja esta fechado nesse ponto, entao a conta e a mesma de
   * sempre. A contrapartida e que um pedido cancelado DEPOIS de entrar
   * em preparo ja tem credito solto — ver `anularCreditoDoPedido`, que
   * desfaz exatamente essa sobra.
   *
   * A base e o valor PAGO EM DINHEIRO: subtotal menos cupom menos o
   * proprio cashback usado. Cashback nao gera cashback — senao o saldo
   * se realimentaria sozinho. A taxa de entrega tambem fica de fora:
   * ela vai integral para quem entrega, entao devolver 5% dela sairia
   * direto da margem da loja.
   *
   * A constraint @@unique([orderId]) no banco e o que garante, de fato,
   * que o mesmo pedido nunca gere dois creditos — mesmo que seja
   * processado duas vezes.
   */
  async creditarPorPedido(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        number: true,
        storeId: true,
        customerId: true,
        subtotalCents: true,
        discountCents: true,
        cashbackUsedCents: true,
        store: { select: { cashbackPercent: true, cashbackExpiryDays: true } },
      },
    });

    /* Pedido de balcao sem telefone nao tem cliente — nao ha a quem
       creditar. Ver customerId opcional no schema. */
    if (!order?.customerId) return;

    const { cashbackPercent, cashbackExpiryDays } = order.store;
    if (cashbackPercent <= 0) return;

    const basePaga = Math.max(
      0,
      order.subtotalCents - order.discountCents - order.cashbackUsedCents,
    );
    const amountCents = Math.floor((basePaga * cashbackPercent) / 100);

    /* Centavos demais para valer a pena: nao cria credito de R$ 0,00. */
    if (amountCents <= 0) return;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + cashbackExpiryDays);

    /**
     * createMany + skipDuplicates em vez de create dentro de try/catch:
     * o resultado e o mesmo (a constraint @@unique([orderId]) e quem
     * garante que um pedido nunca gera dois creditos), mas aqui o
     * caminho "ja existia" nao passa por excecao — entao nao suja o log
     * com um erro de Prisma que na verdade e o comportamento esperado.
     */
    const criado = await this.prisma.cashbackCredit.createMany({
      data: [
        {
          storeId: order.storeId,
          customerId: order.customerId,
          orderId: order.id,
          amountCents,
          remainingCents: amountCents,
          expiresAt,
        },
      ],
      skipDuplicates: true,
    });

    if (criado.count > 0) {
      this.logger.log(
        `Cashback de ${(amountCents / 100).toFixed(2)} creditado no pedido ${order.number}`,
      );
    }
  }

  /**
   * Anula o que sobrou do credito de um pedido cancelado.
   *
   * O credito nasce quando o pedido entra em preparo — antes de estar de
   * fato entregue. Se depois disso o pedido for cancelado, o credito
   * precisa ser desfeito: senao o cliente fica com cashback de um pedido
   * que nunca chegou. So zera o que ainda esta disponivel
   * (`remainingCents`); a parte que ja tiver sido GASTA em outro pedido
   * nao pode ser reavida sem criar saldo negativo em outro lugar — fica
   * como perda aceita, do mesmo jeito que um estorno de cartao nao
   * consegue tirar de volta um produto ja entregue por causa dele.
   *
   * Roda na MESMA transacao da mudanca de status, e nao depois: e uma
   * escrita simples no banco (sem chamada de rede), entao nao ha motivo
   * para arriscar o pedido cancelar mas o credito ficar de pe.
   */
  async anularCreditoDoPedido(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const credito = await tx.cashbackCredit.findUnique({
      where: { orderId },
      select: { id: true, remainingCents: true },
    });

    if (!credito || credito.remainingCents <= 0) return;

    await tx.cashbackCredit.update({
      where: { id: credito.id },
      data: { remainingCents: 0, expiredAt: new Date() },
    });

    this.logger.log(
      `Pedido cancelado: anulado credito de cashback nao gasto (${(credito.remainingCents / 100).toFixed(2)})`,
    );
  }

  /**
   * Marca como expirado o que passou da validade.
   *
   * Nao muda o saldo (as consultas ja ignoram credito vencido pelo
   * expiresAt) — serve para o job de aviso nao reprocessar credito
   * velho todo dia e para dar historico de quanto expirou sem uso.
   */
  async expirarVencidos(): Promise<number> {
    const resultado = await this.prisma.cashbackCredit.updateMany({
      where: { expiresAt: { lte: new Date() }, expiredAt: null },
      data: { expiredAt: new Date() },
    });

    if (resultado.count > 0) {
      this.logger.log(`${resultado.count} credito(s) de cashback marcados como expirados`);
    }
    return resultado.count;
  }
}
