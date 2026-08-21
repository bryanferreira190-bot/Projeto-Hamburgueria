import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { CashbackAdminService } from './cashback-admin.service';
import { CashbackExpiryJob } from './cashback-expiry.job';
import { CashbackController } from './cashback.controller';
import { CashbackService } from './cashback.service';

/**
 * Exporta CashbackService porque OrdersModule precisa dele para
 * creditar quando o pedido e concluido e para consumir saldo no
 * checkout. O caminho contrario nao existe — cashback nao conhece
 * pedido, so recebe o id.
 *
 * Exporta CashbackAdminService tambem: NotificationsModule usa
 * `listarClientesComSaldo()` para o disparo manual de lembrete de
 * cashback (botao "Disparar mensagem" na aba Cashback do admin) —
 * mesma lista que ja alimenta `GET /admin/cashback`, sem duplicar a
 * consulta.
 */
@Module({
  imports: [WhatsAppModule],
  controllers: [CashbackController],
  providers: [CashbackService, CashbackAdminService, CashbackExpiryJob],
  exports: [CashbackService, CashbackAdminService],
})
export class CashbackModule {}
