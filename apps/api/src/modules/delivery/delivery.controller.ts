import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { deliveryQuoteSchema, type DeliveryQuoteInput } from '@adventure/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators';
import { DeliveryService, type DeliveryQuote } from './delivery.service';

@Public()
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  /** Consulta a taxa antes de fechar o pedido. */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(
    @Body(new ZodValidationPipe(deliveryQuoteSchema)) body: DeliveryQuoteInput,
  ): Promise<DeliveryQuote> {
    return this.delivery.quote(body.district);
  }
}
