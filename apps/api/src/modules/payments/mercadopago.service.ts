import { Inject, Injectable } from '@nestjs/common';
import {
  MercadoPagoConfig,
  Order as MpOrder,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError,
  SignatureFailureReason,
} from 'mercadopago';
import type { OrderResponse } from 'mercadopago/dist/clients/order/commonTypes';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Fina camada sobre o SDK oficial do Mercado Pago.
 *
 * So sabe falar com a API deles (criar cobranca PIX, consultar pedido,
 * validar assinatura de webhook) — nao conhece Pedido nosso nem Prisma.
 * Quem decide o que fazer com a resposta e o PaymentsService.
 *
 * Usa a ORDERS API (`/v1/orders`), nao a Payments API classica
 * (`/v1/payments`). As duas existem e parecem equivalentes na
 * documentacao, mas na pratica a Payments API recusou toda tentativa de
 * criar PIX nesta conta com "Unauthorized use of live credentials" —
 * mesmo com credencial de teste valida e comprador de teste genuino. A
 * Orders API funcionou de primeira com a mesma credencial. Ver
 * DECISOES.md para os testes que levaram a essa troca.
 */
@Injectable()
export class MercadoPagoService {
  private readonly order: MpOrder;

  constructor(@Inject(ENV) private readonly env: Env) {
    /* Vazio quando a variavel ainda nao foi configurada no Railway — o
       SDK e instanciado do mesmo jeito, mas nenhuma chamada acontece
       antes de `configurado` ser checado (ver createPixForOrder). */
    const config = new MercadoPagoConfig({ accessToken: env.MERCADOPAGO_ACCESS_TOKEN || 'sem-token' });
    this.order = new MpOrder(config);
  }

  get configurado(): boolean {
    return Boolean(this.env.MERCADOPAGO_ACCESS_TOKEN);
  }

  /**
   * Cria a cobranca PIX no Mercado Pago.
   *
   * O valor vai em REAIS, como string com duas casas decimais ("39.90")
   * — e o formato que a Orders API exige. A conversao e so para a
   * chamada externa; o resto do sistema continua trabalhando em centavos.
   */
  async createPixOrder(params: {
    orderId: string;
    orderNumber: string;
    amountCents: number;
    payerEmail: string;
    payerFirstName?: string | undefined;
    notificationUrl: string;
    expiresInMinutes: number;
  }): Promise<OrderResponse> {
    const valor = (Math.round(params.amountCents) / 100).toFixed(2);

    return this.order.create({
      body: {
        type: 'online',
        total_amount: valor,
        description: `Pedido ${params.orderNumber} — Adventure Burguer`,
        /* Liga o pedido do Mercado Pago ao nosso; e o que o webhook usa
           para achar de volta qual Order atualizar. */
        external_reference: params.orderId,
        payer: {
          email: params.payerEmail,
          ...(params.payerFirstName ? { first_name: params.payerFirstName } : {}),
        },
        transactions: {
          payments: [
            {
              amount: valor,
              payment_method: { type: 'bank_transfer', id: 'pix' },
              /* Duracao ISO 8601 ("PT30M" = 30 minutos), nao data absoluta
                 — "date_of_expiration" no ENVIO da um 400
                 "additionalProperties not allowed" nesta API. Ela volta
                 calculada (absoluta) na resposta, e e essa que o resto do
                 codigo le. */
              expiration_time: `PT${params.expiresInMinutes}M`,
            },
          ],
        },
        config: {
          online: { callback_url: params.notificationUrl },
        },
      },
      requestOptions: {
        /* Uma cobranca por pedido: se a chamada for repetida (retry de
           rede, por exemplo), o Mercado Pago devolve o MESMO pedido em
           vez de criar um segundo para o mesmo pedido nosso. */
        idempotencyKey: `pix-${params.orderId}`,
      },
    });
  }

  async getOrder(externalId: string): Promise<OrderResponse> {
    return this.order.get({ id: externalId });
  }

  /**
   * Confirma que a notificacao realmente veio do Mercado Pago.
   *
   * Sem isso, qualquer um que descobrisse a URL do webhook poderia mandar
   * "pagamento aprovado" para um pedido que nunca foi pago. Lanca
   * InvalidWebhookSignatureError quando a assinatura nao bate — o
   * controller decide o que responder.
   */
  validateWebhookSignature(params: {
    xSignature: string | undefined;
    xRequestId: string | undefined;
    dataId: string | undefined;
  }): void {
    if (!this.env.MERCADOPAGO_WEBHOOK_SECRET) {
      /* Assinatura ainda nao configurada no Railway: recusa tudo em vez de
         confiar cegamente em notificacao nao verificada. */
      throw new InvalidWebhookSignatureError(SignatureFailureReason.MissingSignatureHeader);
    }

    WebhookSignatureValidator.validate({
      xSignature: params.xSignature,
      xRequestId: params.xRequestId,
      dataId: params.dataId,
      secret: this.env.MERCADOPAGO_WEBHOOK_SECRET,
      /* 5 minutos de tolerancia contra reenvio de notificacao antiga. */
      toleranceSeconds: 300,
    });
  }
}
