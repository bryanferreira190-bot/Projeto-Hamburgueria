import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MercadoPagoService } from './mercadopago.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Nao importa OrdersModule de proposito — ver o comentario no topo de
 * PaymentsService sobre por que isso evitaria uma dependencia circular.
 * NotificationsModule nao tem esse problema: nao depende de Orders nem
 * de Payments, so de Prisma/Config (globais).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  providers: [MercadoPagoService, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
