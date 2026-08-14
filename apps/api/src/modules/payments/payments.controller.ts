import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { MercadoPagoService } from './mercadopago.service';
import { PaymentsService } from './payments.service';

interface WebhookBody {
  type?: string;
  action?: string;
  data?: { id?: string };
}

/**
 * Recebe as notificacoes do Mercado Pago.
 *
 * SEMPRE responde 200 quando a assinatura e valida, mesmo que o
 * processamento interno falhe por outro motivo — devolver erro faria o
 * Mercado Pago ficar retentando indefinidamente uma notificacao que nunca
 * vai se resolver sozinha. So a assinatura invalida vira 401: essa, sim,
 * pode ser uma tentativa de forjar "pagamento aprovado".
 */
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly mercadoPago: MercadoPagoService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Body() body: WebhookBody,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query('data.id') dataIdQuery: string | undefined,
  ): Promise<{ received: true }> {
    /* O Mercado Pago assina pelo id que vem na QUERY STRING da notificacao,
       nao pelo id no corpo — os dois costumam coincidir, mas a validacao
       tem que usar exatamente o que foi assinado. */
    const dataId = dataIdQuery ?? body.data?.id;

    try {
      this.mercadoPago.validateWebhookSignature({ xSignature, xRequestId, dataId });
    } catch (error) {
      this.logger.warn(`Webhook com assinatura invalida: ${(error as Error).message}`);
      throw new UnauthorizedException('Assinatura invalida');
    }

    try {
      await this.payments.handleNotification(body.type, dataId);
    } catch (error) {
      this.logger.error('Falha ao processar notificacao do Mercado Pago', error as Error);
    }

    return { received: true };
  }
}
