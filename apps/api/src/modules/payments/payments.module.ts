import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Nao importa OrdersModule de proposito — ver o comentario no topo de
 * PaymentsService sobre por que isso evitaria uma dependencia circular.
 */
@Module({
  controllers: [PaymentsController],
  providers: [MercadoPagoService, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
