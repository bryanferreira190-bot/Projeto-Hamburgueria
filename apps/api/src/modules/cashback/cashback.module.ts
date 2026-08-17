import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CashbackAdminService } from './cashback-admin.service';
import { CashbackExpiryJob } from './cashback-expiry.job';
import { CashbackController } from './cashback.controller';
import { CashbackService } from './cashback.service';

/**
 * Exporta o CashbackService porque OrdersModule precisa dele para
 * creditar quando o pedido e concluido e para consumir saldo no
 * checkout. O caminho contrario nao existe — cashback nao conhece
 * pedido, so recebe o id.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [CashbackController],
  providers: [CashbackService, CashbackAdminService, CashbackExpiryJob],
  exports: [CashbackService],
})
export class CashbackModule {}
