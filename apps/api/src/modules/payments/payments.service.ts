import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  assertTransition,
  type CardPaymentInput,
} from '@adventure/shared';
import type { OrderResponse } from 'mercadopago/dist/clients/order/commonTypes';
import { Inject } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MercadoPagoService } from './mercadopago.service';

const MINUTOS_PARA_EXPIRAR_PIX = 30;

export interface PixParaExibir {
  status: PaymentStatus;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  pixExpiresAt: Date | null;
}

/**
 * Traduz o status de texto livre do PEDIDO do Mercado Pago (Orders API)
 * para o enum fechado que o resto do sistema usa. Ficar num lugar so
 * evita a mesma cadeia de if espalhada pelo codigo.
 *
 * Valores documentados em
 * https://www.mercadopago.com.ar/developers/en/docs/checkout-api-orders/payment-management/status/order-status
 */
function mapearStatus(mpStatus: string | undefined): PaymentStatus {
  switch (mpStatus) {
    case 'processed':
      return PaymentStatus.PAID;
    case 'refunded':
    case 'charged_back':
      return PaymentStatus.REFUNDED;
    case 'failed':
      return PaymentStatus.FAILED;
    case 'canceled':
    case 'expired':
      return PaymentStatus.CANCELED;
    case 'created':
    case 'processing':
    case 'action_required':
    default:
      return PaymentStatus.PENDING;
  }
}

/**
 * Traduz o motivo da recusa do cartao para algo que o cliente entenda e
 * saiba o que fazer.
 *
 * Vale o esforco de mapear um a um: "saldo insuficiente" e "dados
 * incorretos" levam a acoes opostas, e uma mensagem generica faria a
 * pessoa tentar o mesmo cartao de novo sem sucesso — ou desistir da
 * compra achando que o site esta quebrado.
 *
 * Codigos em https://www.mercadopago.com.br/developers, secao
 * "Recusas de pagamento por cartao".
 */
function mensagemDaRecusa(motivo: string): string {
  const mensagens: Record<string, string> = {
    insufficient_amount: 'Cartao sem limite suficiente. Tente outro cartao ou pague com PIX.',
    bad_filled_card_data: 'Confira os dados do cartao: numero, validade e codigo de seguranca.',
    bad_filled_security_code: 'Codigo de seguranca (CVV) incorreto.',
    bad_filled_date: 'Data de validade incorreta.',
    bad_filled_other: 'Algum dado do cartao esta incorreto. Confira e tente de novo.',
    rejected_by_issuer: 'Seu banco recusou a compra. Entre em contato com ele ou use outro cartao.',
    cc_rejected_call_for_authorize: 'Seu banco pede autorizacao para esta compra. Ligue para ele e tente de novo.',
    cc_rejected_card_disabled: 'Cartao desativado. Fale com seu banco ou use outro cartao.',
    cc_rejected_duplicated_payment: 'Ja existe uma compra igual em andamento. Confira antes de tentar de novo.',
    cc_rejected_high_risk: 'A compra foi recusada por seguranca. Tente outro cartao ou pague com PIX.',
    cc_rejected_max_attempts: 'Muitas tentativas com este cartao. Tente outro ou pague com PIX.',
    invalid_installments: 'Este cartao nao aceita o parcelamento escolhido.',
    card_not_allowed: 'Este tipo de cartao nao e aceito. Tente outro ou pague com PIX.',
  };

  return (
    mensagens[motivo] ??
    'Nao foi possivel aprovar o pagamento neste cartao. Tente outro cartao ou pague com PIX.'
  );
}

/**
 * Orquestra pagamento: cria a cobranca PIX quando o pedido nasce, e
 * processa a notificacao do Mercado Pago quando o status muda.
 *
 * NAO depende de OrdersModule de proposito. Pedido cria pagamento (Orders
 * -> Payments) e pagamento confirma pedido (Payments -> Orders) formam um
 * ciclo natural; em vez de resolver isso com forwardRef(), o pouco que
 * este servico precisa saber de Order (status, numero) ele le e escreve
 * direto pelo Prisma — que ja e global — mantendo a dependencia entre
 * modulos numa via so.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Cria a cobranca PIX no Mercado Pago e grava o Payment.
   *
   * Chamado DEPOIS que a transacao de criacao do pedido ja commitou — uma
   * chamada de rede nao deveria acontecer com uma transacao de banco
   * aberta. Se o Mercado Pago falhar, quem chamou decide o que fazer com
   * o pedido (ver OrdersService.create).
   */
  async createPixForOrder(order: {
    id: string;
    number: string;
    totalCents: number;
    payerEmail: string;
    payerFirstName?: string | undefined;
  }): Promise<PixParaExibir> {
    if (!this.mercadoPago.configurado) {
      throw new BadRequestException(
        'Pagamento por PIX esta temporariamente indisponivel. Escolha outra forma de pagamento.',
      );
    }

    const publicUrl = this.env.PUBLIC_API_URL || 'https://api.impactdev.site';

    let resposta: OrderResponse;
    try {
      resposta = await this.mercadoPago.createPixOrder({
        orderId: order.id,
        orderNumber: order.number,
        amountCents: order.totalCents,
        payerEmail: order.payerEmail,
        payerFirstName: order.payerFirstName,
        notificationUrl: `${publicUrl}/api/v1/payments/webhook`,
        expiresInMinutes: MINUTOS_PARA_EXPIRAR_PIX,
      });
    } catch (error) {
      this.logger.error(`Falha ao criar cobranca PIX para o pedido ${order.number}`, error as Error);
      throw new BadRequestException(
        'Nao foi possivel gerar a cobranca PIX agora. Tente novamente em instantes.',
      );
    }

    const transacao = resposta.transactions?.payments?.[0];
    const dados = transacao?.payment_method;
    if (!resposta.id || !dados?.qr_code) {
      this.logger.error(
        `Mercado Pago respondeu sem QR Code para o pedido ${order.number}: ${JSON.stringify(resposta)}`,
      );
      throw new BadRequestException(
        'Nao foi possivel gerar a cobranca PIX agora. Tente novamente em instantes.',
      );
    }

    /* A expiracao do PAGAMENTO especifico e mais precisa que a do pedido
       como um todo — e a que o cliente realmente ve no seu app do banco. */
    const pixExpiresAt = transacao?.date_of_expiration ? new Date(transacao.date_of_expiration) : null;

    /**
     * A PARTIR DAQUI A COBRANCA JA EXISTE NO MERCADO PAGO.
     *
     * Se a gravacao falhar, fica uma cobranca que o cliente consegue
     * pagar e que nos nao sabemos que existe: o webhook chegaria, nao
     * acharia Payment nenhum e ignoraria — dinheiro entrando sem pedido
     * correspondente. Por isso a escrita e tentada mais de uma vez antes
     * de desistir (falha de conexao com o banco costuma ser passageira),
     * e o fracasso final e registrado com o id da cobranca, para dar
     * para conciliar na mao.
     */
    try {
      await this.gravarPagamentoComRetentativa({
        orderId: order.id,
        metodo: PaymentMethod.PIX,
        status: mapearStatus(resposta.status),
        amountCents: order.totalCents,
        externalId: String(resposta.id),
        idempotencyKey: `pix-${order.id}`,
        qrCodeBase64: dados.qr_code_base64 ?? null,
        copiaECola: dados.qr_code,
        pixExpiresAt,
      });
    } catch (error) {
      this.logger.error(
        `COBRANCA ORFA: PIX ${resposta.id} criado no Mercado Pago para o pedido ` +
          `${order.number} (${order.id}), mas nao foi possivel gravar o Payment. ` +
          `Se o cliente pagar, o valor entra sem pedido correspondente — ` +
          `cancele a cobranca no painel do Mercado Pago.`,
        error as Error,
      );
      throw new BadRequestException(
        'Nao foi possivel gerar a cobranca PIX agora. Tente novamente em instantes.',
      );
    }

    this.logger.log(`Cobranca PIX ${resposta.id} criada para o pedido ${order.number}`);

    return {
      status: mapearStatus(resposta.status),
      pixQrCode: dados.qr_code_base64 ?? null,
      pixCopyPaste: dados.qr_code,
      pixExpiresAt,
    };
  }

  /**
   * Cobra no cartao e grava o Payment.
   *
   * Diferente do PIX, o resultado ja e definitivo quando esta funcao
   * retorna: `aprovado: true` significa que o dinheiro foi autorizado e o
   * pedido pode seguir para a cozinha na hora, sem esperar webhook.
   */
  async createCardForOrder(order: {
    id: string;
    number: string;
    totalCents: number;
    payerEmail: string;
    payerFirstName?: string | undefined;
    card: CardPaymentInput;
  }): Promise<{ aprovado: boolean }> {
    if (!this.mercadoPago.configurado) {
      throw new BadRequestException(
        'Pagamento com cartao esta temporariamente indisponivel. Escolha outra forma de pagamento.',
      );
    }

    const publicUrl = this.env.PUBLIC_API_URL || 'https://api.impactdev.site';

    let resultado: Awaited<ReturnType<typeof this.mercadoPago.createCardOrder>>;
    try {
      resultado = await this.mercadoPago.createCardOrder({
        orderId: order.id,
        orderNumber: order.number,
        amountCents: order.totalCents,
        payerEmail: order.payerEmail,
        payerFirstName: order.payerFirstName,
        notificationUrl: `${publicUrl}/api/v1/payments/webhook`,
        cardToken: order.card.token,
        cardPaymentMethodId: order.card.paymentMethodId,
        installments: order.card.installments,
      });
    } catch (error) {
      /* Falha de rede/indisponibilidade — nao e recusa do cartao. */
      this.logger.error(`Falha ao cobrar o cartao do pedido ${order.number}`, error as Error);
      throw new BadRequestException(
        'Nao foi possivel processar o pagamento agora. Tente novamente em instantes.',
      );
    }

    if (!resultado.ok) {
      this.logger.log(`Cartao recusado no pedido ${order.number}: ${resultado.motivo}`);
      /* Nada foi cobrado; nao ha Payment a gravar. */
      throw new BadRequestException(mensagemDaRecusa(resultado.motivo));
    }

    const resposta = resultado.pedido;
    const status = mapearStatus(resposta.status);

    await this.gravarPagamentoComRetentativa({
      orderId: order.id,
      metodo: PaymentMethod.CREDIT_CARD,
      status,
      amountCents: order.totalCents,
      externalId: String(resposta.id),
      idempotencyKey: `card-${order.id}`,
      qrCodeBase64: null,
      copiaECola: null,
      pixExpiresAt: null,
      ...(status === PaymentStatus.PAID ? { paidAt: new Date() } : {}),
    });

    this.logger.log(
      `Cartao aprovado no pedido ${order.number} (cobranca ${resposta.id}, ` +
        `${order.card.installments}x)`,
    );

    return { aprovado: status === PaymentStatus.PAID };
  }

  /**
   * Grava o Payment, insistindo em caso de falha passageira.
   *
   * O banco (Neon) usa conexao direta e hiberna quando fica ocioso; a
   * primeira escrita depois de uma pausa pode falhar com erro de
   * conexao. Como esta gravacao acontece logo apos uma chamada de rede
   * de alguns segundos ao Mercado Pago, ela e justamente a mais exposta
   * a isso — e a que menos pode se dar ao luxo de falhar, porque a
   * cobranca ja foi criada la.
   */
  private async gravarPagamentoComRetentativa(dados: {
    orderId: string;
    metodo: PaymentMethod;
    status: PaymentStatus;
    amountCents: number;
    externalId: string;
    idempotencyKey: string;
    qrCodeBase64: string | null;
    copiaECola: string | null;
    pixExpiresAt: Date | null;
    paidAt?: Date;
  }): Promise<void> {
    const TENTATIVAS = 3;

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      try {
        await this.prisma.payment.create({
          data: {
            orderId: dados.orderId,
            provider: 'mercadopago',
            method: dados.metodo,
            status: dados.status,
            amountCents: dados.amountCents,
            externalId: dados.externalId,
            idempotencyKey: dados.idempotencyKey,
            pixQrCode: dados.qrCodeBase64,
            pixCopyPaste: dados.copiaECola,
            pixExpiresAt: dados.pixExpiresAt,
            ...(dados.paidAt ? { paidAt: dados.paidAt } : {}),
          },
        });
        return;
      } catch (error) {
        if (tentativa === TENTATIVAS) throw error;

        this.logger.warn(
          `Falha ao gravar Payment do pedido ${dados.orderId} ` +
            `(tentativa ${tentativa}/${TENTATIVAS}), tentando de novo: ${(error as Error).message}`,
        );
        /* Espera curta e crescente: da tempo de a conexao se restabelecer
           sem segurar a resposta ao cliente por muito tempo. */
        await new Promise((resolve) => setTimeout(resolve, 200 * tentativa));
      }
    }
  }

  /**
   * Processa a notificacao do Mercado Pago.
   *
   * O corpo do webhook so avisa QUAL pedido mudou — nunca confiamos no
   * valor/status que ele traz. A fonte da verdade e sempre uma consulta
   * de volta na API deles (getOrder), que so um id valido consegue
   * responder.
   */
  async handleNotification(tipo: string | undefined, dataId: string | undefined): Promise<void> {
    if (tipo !== 'order' || !dataId) {
      /* "merchant_order" e outros tipos de evento nao dizem respeito a
         nenhum Payment nosso — nao e erro, so nao ha o que fazer. */
      return;
    }

    const resposta = await this.mercadoPago.getOrder(dataId);
    if (!resposta.id) return;

    const payment = await this.prisma.payment.findUnique({
      where: { provider_externalId: { provider: 'mercadopago', externalId: String(resposta.id) } },
      select: { id: true, orderId: true, status: true },
    });

    if (!payment) {
      /* Pedido que o Mercado Pago conhece mas nos nao — acontece em
         testes manuais pelo painel deles, direcionados para o nosso
         webhook por engano. Nao e motivo para erro 500. */
      this.logger.warn(`Webhook para pedido ${resposta.id}, sem Payment correspondente`);
      return;
    }

    const novoStatus = mapearStatus(resposta.status);

    /* Notificacao repetida com o mesmo status: nada novo a fazer. Evita
       tentar a mesma transicao de pedido duas vezes. */
    if (novoStatus === payment.status) return;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: novoStatus,
        ...(novoStatus === PaymentStatus.PAID ? { paidAt: new Date() } : {}),
        ...(novoStatus === PaymentStatus.FAILED || novoStatus === PaymentStatus.CANCELED
          ? { failureReason: resposta.status_detail ?? null }
          : {}),
      },
    });

    await this.avancarPedidoConformePagamento(payment.orderId, novoStatus);
  }

  /**
   * Estorna o pagamento do pedido, se houver um ja aprovado.
   *
   * Chamado quando um pedido pago e cancelado. Pedido com PIX ainda
   * pendente ou pago na entrega (sem Payment nenhum) nao tem o que
   * estornar — so sai sem fazer nada.
   *
   * Falha ao estornar NAO impede o cancelamento (quem chama ja commitou
   * isso antes de chegar aqui) — e melhor a cozinha parar na hora e o
   * estorno ser resolvido na mao do que o pedido ficar preso porque a
   * Mercado Pago esta fora do ar. Fica registrado bem alto no log,
   * mesmo padrao da "COBRANCA ORFA" acima, para conciliacao manual.
   */
  async refundIfPaid(orderId: string, orderNumber: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: PaymentStatus.PAID },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment?.externalId) return;

    try {
      await this.mercadoPago.refundOrder(payment.externalId);
    } catch (error) {
      this.logger.error(
        `ESTORNO FALHOU: pedido ${orderNumber} foi cancelado mas o pagamento ` +
          `${payment.externalId} (R$ ${(payment.amountCents / 100).toFixed(2)}) nao foi estornado ` +
          `na Mercado Pago. Estorne manualmente pelo painel deles.`,
        error as Error,
      );
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.REFUNDED, refundedAt: new Date() },
    });

    this.logger.log(`Pagamento ${payment.externalId} do pedido ${orderNumber} estornado.`);
  }

  /**
   * So mexe no pedido se ele ainda estiver esperando esse pagamento —
   * protege contra webhook fora de ordem ou reenviado depois que o
   * status ja mudou por outro caminho (ex.: admin confirmou na mao).
   */
  private async avancarPedidoConformePagamento(
    orderId: string,
    statusDoPagamento: PaymentStatus,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, number: true, status: true },
    });
    if (!order || order.status !== OrderStatus.PENDING_PAYMENT) return;

    const proximo =
      statusDoPagamento === PaymentStatus.PAID
        ? OrderStatus.CONFIRMED
        : statusDoPagamento === PaymentStatus.FAILED || statusDoPagamento === PaymentStatus.CANCELED
          ? OrderStatus.CANCELED
          : null;
    if (!proximo) return;

    try {
      assertTransition(order.status, proximo);
    } catch {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: proximo,
          ...(proximo === OrderStatus.CONFIRMED ? { confirmedAt: new Date() } : {}),
          ...(proximo === OrderStatus.CANCELED
            ? { canceledAt: new Date(), cancelReason: 'Pagamento nao aprovado' }
            : {}),
        },
      }),
      this.prisma.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: proximo,
          reason:
            proximo === OrderStatus.CONFIRMED
              ? 'Pagamento aprovado via Mercado Pago'
              : 'Pagamento recusado ou cancelado via Mercado Pago',
        },
      }),
    ]);

    this.logger.log(`Pedido ${order.number}: ${order.status} -> ${proximo} (webhook Mercado Pago)`);
  }
}
