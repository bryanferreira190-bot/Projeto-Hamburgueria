import { Body, Controller, Get, NotFoundException, Param, Put, Post, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminRole, NotificationEvent, phoneSchema, type NotificationEvent as TNotificationEvent } from '@adventure/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RequireRole } from '../auth/decorators';
import { CashbackAdminService } from '../cashback/cashback-admin.service';
import { MessageTemplateService } from './message-template.service';
import { MessagingService } from './messaging.service';

const envioDeTesteSchema = z.object({
  phone: phoneSchema,
  message: z.string().trim().min(1).max(1000),
});
type EnvioDeTeste = z.infer<typeof envioDeTesteSchema>;

const dispararCashbackSchema = z.object({
  message: z.string().trim().min(1).max(1000),
});
type DispararCashbackInput = z.infer<typeof dispararCashbackSchema>;

const atualizarTemplateSchema = z.object({
  message: z.string().trim().min(1).max(1000).optional(),
  isActive: z.boolean().optional(),
});
type AtualizarTemplateInput = z.infer<typeof atualizarTemplateSchema>;

/** Nunca aceita o valor cru da URL como enum sem checar antes. */
const chaveDeEventoSchema = z.enum(
  Object.keys(NotificationEvent) as [TNotificationEvent, ...TNotificationEvent[]],
);

/**
 * NOTIFICACOES AUTOMATICAS DE PEDIDO — ADMINISTRACAO
 *
 * Rotas OWNER, mesma exigencia do modulo whatsapp/ (Meta): mensagem de
 * teste gasta janela de conversa real quando o provedor esta ligado, e
 * editar template afeta todo cliente daquele evento dali para frente.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly templates: MessageTemplateService,
    private readonly prisma: PrismaService,
    private readonly cashbackAdmin: CashbackAdminService,
  ) {}

  /**
   * Estado da integracao — qual provedor esta ativo e se a instancia
   * esta conectada ao WhatsApp. Nunca expoe a API key.
   */
  @RequireRole(AdminRole.OWNER)
  @Get('status')
  async status() {
    const saude = await this.messaging.checkHealth();
    return {
      ativo: this.messaging.ativo,
      provider: saude.provider,
      conectado: saude.connected,
      detalhe: saude.detail,
    };
  }

  /**
   * Envio de teste — dispara mensagem real para um numero arbitrario
   * quando o provedor estiver ligado. Throttle baixo pelo mesmo motivo
   * do endpoint equivalente em whatsapp/: nao e coisa para clicar em
   * loop.
   */
  @RequireRole(AdminRole.OWNER)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('test')
  async testar(@Body(new ZodValidationPipe(envioDeTesteSchema)) corpo: EnvioDeTeste) {
    return this.messaging.enviarTeste(corpo.phone, corpo.message);
  }

  /** Todos os templates da loja, criando com texto padrao quem faltar. */
  @RequireRole(AdminRole.OWNER)
  @Get('templates')
  async listarTemplates() {
    const store = await this.prisma.store.findFirst({ select: { id: true } });
    if (!store) return [];
    return this.templates.listar(store.id);
  }

  @RequireRole(AdminRole.OWNER)
  @Put('templates/:event')
  async atualizarTemplate(
    @Param('event', new ZodValidationPipe(chaveDeEventoSchema)) event: TNotificationEvent,
    @Body(new ZodValidationPipe(atualizarTemplateSchema)) corpo: AtualizarTemplateInput,
  ) {
    const store = await this.prisma.store.findFirst({ select: { id: true } });
    if (!store) throw new NotFoundException('Loja nao configurada');
    return this.templates.atualizar(store.id, event, corpo);
  }

  /** Volta o texto de um evento ao padrao de fabrica (mantem o isActive atual). */
  @RequireRole(AdminRole.OWNER)
  @HttpCode(200)
  @Post('templates/:event/restore')
  async restaurarTemplate(@Param('event', new ZodValidationPipe(chaveDeEventoSchema)) event: TNotificationEvent) {
    const store = await this.prisma.store.findFirst({ select: { id: true } });
    if (!store) throw new NotFoundException('Loja nao configurada');
    return this.templates.restaurarPadrao(store.id, event);
  }

  /**
   * Disparo manual em massa — botao "Disparar mensagem" na aba
   * Cashback (admin). Manda AGORA, para todo cliente com saldo AGORA
   * (`CashbackAdminService.listarClientesComSaldo()`, a mesma lista de
   * `GET /admin/cashback`). Throttle baixo so contra duplo-clique — a
   * frequencia de uso e uma decisao do admin, avisada na tela, nao
   * imposta aqui.
   */
  @RequireRole(AdminRole.OWNER)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @Post('cashback-blast')
  async dispararCashback(@Body(new ZodValidationPipe(dispararCashbackSchema)) corpo: DispararCashbackInput) {
    const resumo = await this.cashbackAdmin.listarClientesComSaldo();

    return this.messaging.enviarEmMassa(
      corpo.message,
      resumo.clientes.map((cliente) => ({
        phone: cliente.phone,
        nome: cliente.name,
        cashbackCents: cliente.saldoCents,
      })),
    );
  }
}
