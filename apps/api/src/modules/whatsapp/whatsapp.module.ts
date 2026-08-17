import { Module } from '@nestjs/common';
import { MetaGraphClient } from './meta-graph.client';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WhatsAppService } from './whatsapp.service';

/**
 * Integracao com a WhatsApp Cloud API (Meta).
 *
 * Totalmente desacoplado do negocio: nao importa OrdersModule,
 * CashbackModule nem PrismaModule, e nao sabe o que e pedido ou cliente
 * — so recebe telefone, texto e variaveis. Quem precisa avisar alguem
 * importa este modulo, nunca o contrario. Assim, mexer em pedido nunca
 * quebra o envio, e mexer no envio nunca quebra pedido.
 */
@Module({
  controllers: [WhatsAppController],
  providers: [MetaGraphClient, WhatsAppService, WhatsAppWebhookService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
