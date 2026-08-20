import { Module } from '@nestjs/common';
import { EvolutionWhatsAppProvider } from './providers/evolution-whatsapp.provider';
import { MessageTemplateService } from './message-template.service';
import { MessagingService } from './messaging.service';
import { NotificationsController } from './notifications.controller';

/**
 * NOTIFICACOES AUTOMATICAS DE PEDIDO (WhatsApp via Evolution API)
 *
 * Modulo desacoplado do negocio, no mesmo espirito do modules/whatsapp/
 * (Meta): nao importa OrdersModule nem PaymentsModule — sao ELES que
 * importam este. Quem quiser avisar alguem chama MessagingService.notificar()
 * com o contexto do pedido; este modulo nao sabe (nem precisa saber) o
 * que aconteceu para o evento ter disparado.
 *
 * Ver DECISOES.md para por que este modulo, com Evolution/Baileys,
 * existe ao lado do modules/whatsapp/ (Meta Cloud API, dormente) em vez
 * de substituir um pelo outro.
 */
@Module({
  controllers: [NotificationsController],
  providers: [EvolutionWhatsAppProvider, MessageTemplateService, MessagingService],
  exports: [MessagingService],
})
export class NotificationsModule {}
