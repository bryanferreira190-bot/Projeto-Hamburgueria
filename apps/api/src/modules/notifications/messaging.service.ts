import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ORDER_STATUS_LABELS,
  formatBRL,
  type NotificationEvent,
  type OrderStatus,
} from '@adventure/shared';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CashbackService } from '../cashback/cashback.service';
import { mascararTelefone, paraFormatoInternacional } from '../whatsapp/whatsapp.utils';
import { EvolutionWhatsAppProvider } from './providers/evolution-whatsapp.provider';
import type { ProviderHealth, WhatsAppProvider } from './providers/whatsapp-provider.interface';
import { MessageTemplateService } from './message-template.service';

/** Dados do pedido necessarios para montar e mandar a notificacao. */
export interface OrderNotificationContext {
  storeId: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  /** So digitos, com DDD, sem 55 — formato que o Customer.phone guarda. Null = pedido sem telefone (balcao). */
  phone: string | null;
  totalCents: number;
  status: OrderStatus;
  /**
   * Itens do pedido, para o placeholder `{itens}`. Opcional: eventos
   * que nao tem um pedido de verdade por tras (CASHBACK_REMINDER,
   * disparo em massa) simplesmente nao passam isto, e o placeholder
   * vira vazio se o texto o usar.
   */
  items?: { productName: string; quantity: number }[];
}

export interface NotificationResult {
  enviado: boolean;
  simulado: boolean;
  motivo?: string;
}

/** Quem recebe um envio em massa — so o que o placeholder precisa, nada mais. */
export interface DestinatarioEmMassa {
  phone: string;
  nome: string | null;
  cashbackCents: number;
}

export interface ResultadoEmMassa {
  total: number;
  enviados: number;
  simulados: number;
  falhas: number;
}

/** "Joao da Silva" -> "Joao". Mesmo criterio do modulo whatsapp/. */
function primeiroNome(nome: string | null): string {
  const primeiro = nome?.trim().split(/\s+/)[0];
  return primeiro && primeiro.length > 1 ? primeiro : 'Tudo bem';
}

/** "11970706978" -> "(11) 97070-6978". So para o placeholder {telefone}. */
function formatarTelefone(digitos: string): string {
  if (digitos.length !== 11) return digitos;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

/**
 * [{productName:"Bacon Burguer",quantity:2}] -> "2× Bacon Burguer".
 * Mesmo formato ja usado nas telas do painel e do storefront (ver
 * OrdersPage/CheckoutPage) — so para o placeholder {itens}.
 */
function formatarItens(items: { productName: string; quantity: number }[]): string {
  return items.map((item) => `${item.quantity}× ${item.productName}`).join('\n');
}

/**
 * ORQUESTRADOR DE NOTIFICACAO DE PEDIDO
 *
 * E o "MessagingService" da camada abstrata: OrdersService e
 * PaymentsService so conhecem este servico, nunca a Evolution
 * diretamente. Decide SE manda (interruptor, template ativo,
 * idempotencia), MONTA a mensagem (template + placeholder) e delega o
 * envio em si ao WhatsAppProvider configurado.
 *
 * NUNCA lanca excecao — todo erro e capturado e vira um NotificationResult
 * com `enviado: false`, e quem chama nunca precisa de try/catch. Ver
 * `notificar()`.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly templates: MessageTemplateService,
    private readonly evolution: EvolutionWhatsAppProvider,
    private readonly cashback: CashbackService,
  ) {}

  /** Se ha um provedor configurado e pronto para enviar de verdade. */
  get ativo(): boolean {
    return this.env.WHATSAPP_PROVIDER === 'evolution';
  }

  private get provider(): WhatsAppProvider | null {
    if (this.env.WHATSAPP_PROVIDER === 'evolution') return this.evolution;
    return null;
  }

  async checkHealth(): Promise<ProviderHealth & { provider: string | null }> {
    if (!this.provider) return { connected: false, detail: 'Nenhum provedor configurado', provider: null };
    const saude = await this.provider.checkHealth();
    return { ...saude, provider: this.provider.nome };
  }

  /**
   * Ponto de entrada usado por OrdersService/PaymentsService.
   *
   * PEDIDO E PRIORIDADE. Esta funcao NUNCA lanca — toda falha (provedor
   * fora do ar, template invalido, o que for) e capturada e vira log +
   * retorno, nunca uma excecao que poderia atrapalhar quem chamou. Quem
   * chama, alem disso, NAO deve dar `await` nisto (ver README) — o
   * proprio nome (fire-and-forget) e a razao de nao devolver uma
   * Promise que precise ser esperada por quem decide o status do
   * pedido.
   */
  async notificar(event: NotificationEvent, contexto: OrderNotificationContext): Promise<NotificationResult> {
    try {
      return await this.processar(event, contexto);
    } catch (error) {
      this.logger.error(
        `Falha inesperada ao notificar pedido ${contexto.orderNumber} (${event})`,
        error as Error,
      );
      return { enviado: false, simulado: false, motivo: 'erro interno' };
    }
  }

  /**
   * Envio de teste — usado SOMENTE por `POST /notifications/test`
   * (admin). Manda o texto exatamente como digitado, direto pelo
   * provedor: nao passa por template, placeholder nem idempotencia
   * (nao ha pedido de verdade por tras de um teste, entao gravar em
   * NotificationLog quebraria a FK para `order`).
   */
  async enviarTeste(phone: string, message: string): Promise<NotificationResult> {
    const telefoneInternacional = paraFormatoInternacional(phone);
    const destinatario = mascararTelefone(telefoneInternacional);

    if (!this.provider) {
      this.logger.log(
        JSON.stringify({ evento: 'notificacao.teste.simulada', destinatario }),
      );
      return { enviado: true, simulado: true };
    }

    const resultado = await this.provider.sendText(telefoneInternacional, message);

    this.logger.log(
      JSON.stringify({
        evento: resultado.success ? 'notificacao.teste.enviada' : 'notificacao.teste.falhou',
        destinatario,
        provedor: this.provider.nome,
        ...(resultado.success
          ? { messageId: resultado.externalId ?? null }
          : { erro: resultado.error }),
      }),
    );

    return {
      enviado: resultado.success,
      simulado: false,
      ...(resultado.error ? { motivo: resultado.error } : {}),
    };
  }

  /**
   * Disparo manual em massa — usado SOMENTE pelo botao "Disparar
   * mensagem" da aba Cashback (admin), para todo cliente com saldo
   * agora. Reaproveita `MessageTemplateService.renderizar()` para os
   * placeholders `{nome}`/`{cashback}` (os demais — `{pedido}`,
   * `{valor}`, `{status}`, `{telefone}` — nao fazem sentido aqui, ja que
   * nao ha UM pedido por tras do disparo; ficam vazios se o texto os
   * usar).
   *
   * NAO passa por NotificationLog nem por idempotencia: sao coisas
   * pensadas para "uma vez por pedido", e aqui nao ha pedido, e sim uma
   * lista de clientes decidida na hora pelo admin — quem decide a
   * frequencia e a propria pessoa clicando o botao (por isso o aviso na
   * tela, nao um bloqueio no backend).
   */
  async enviarEmMassa(
    mensagemTemplate: string,
    destinatarios: DestinatarioEmMassa[],
  ): Promise<ResultadoEmMassa> {
    let enviados = 0;
    let simulados = 0;
    let falhas = 0;

    for (const destinatario of destinatarios) {
      const mensagem = this.templates.renderizar(mensagemTemplate, {
        nome: primeiroNome(destinatario.nome),
        pedido: '',
        valor: '',
        status: '',
        telefone: formatarTelefone(destinatario.phone),
        cashback: formatBRL(destinatario.cashbackCents),
        itens: '',
      });

      if (!this.provider) {
        simulados += 1;
        continue;
      }

      const telefoneInternacional = paraFormatoInternacional(destinatario.phone);
      const resultadoDoEnvio = await this.provider.sendText(telefoneInternacional, mensagem);

      if (resultadoDoEnvio.success) enviados += 1;
      else falhas += 1;

      this.logger.log(
        JSON.stringify({
          evento: resultadoDoEnvio.success ? 'notificacao.massa.enviada' : 'notificacao.massa.falhou',
          destinatario: mascararTelefone(telefoneInternacional),
          provedor: this.provider.nome,
          ...(resultadoDoEnvio.success
            ? { messageId: resultadoDoEnvio.externalId ?? null }
            : { erro: resultadoDoEnvio.error }),
        }),
      );
    }

    this.logger.log(
      `Disparo em massa de cashback: ${destinatarios.length} destinatario(s), ${enviados} enviado(s), ` +
        `${falhas} falha(s)` +
        (simulados > 0 ? `, ${simulados} simulado(s) (WHATSAPP_PROVIDER=none)` : '') +
        '.',
    );

    return { total: destinatarios.length, enviados, simulados, falhas };
  }

  private async processar(
    event: NotificationEvent,
    contexto: OrderNotificationContext,
  ): Promise<NotificationResult> {
    if (!contexto.phone) {
      this.logger.debug(`Notificacao ${event} pulada: pedido ${contexto.orderNumber} sem telefone`);
      return { enviado: false, simulado: false, motivo: 'sem telefone' };
    }

    if (!this.provider) {
      this.logger.log(
        JSON.stringify({
          evento: 'notificacao.simulada',
          pedido: contexto.orderNumber,
          tipo: event,
          motivo: 'WHATSAPP_PROVIDER=none',
        }),
      );
      return { enviado: true, simulado: true };
    }

    /**
     * IDEMPOTENCIA: mesmo evento, mesmo pedido, ja teve envio COM
     * SUCESSO antes? Nao manda de novo. Falha anterior NAO conta —
     * o cliente nunca recebeu, entao uma nova tentativa e o
     * comportamento certo, nao duplicidade.
     *
     * Defesa a MAIS, nao a unica: as transicoes de status que disparam
     * isto ja sao protegidas por compare-and-swap em OrdersService e
     * PaymentsService (a mesma transicao nao roda duas vezes). Isto
     * cobre o caso de outro caminho de codigo acabar chamando de novo.
     */
    const jaEnviado = await this.prisma.notificationLog.findFirst({
      where: { orderId: contexto.orderId, event, success: true },
      select: { id: true },
    });
    if (jaEnviado) {
      this.logger.debug(`Notificacao ${event} pulada: pedido ${contexto.orderNumber} ja recebeu`);
      return { enviado: false, simulado: false, motivo: 'ja enviado' };
    }

    const template = await this.templates.obterAtivo(contexto.storeId, event);
    if (!template) {
      this.logger.debug(`Notificacao ${event} pulada: template desligado ou ausente`);
      return { enviado: false, simulado: false, motivo: 'template desativado' };
    }

    const saldoCashbackCents = await this.obterSaldoCashback(contexto.storeId, contexto.phone);

    const mensagem = this.templates.renderizar(template.message, {
      nome: primeiroNome(contexto.customerName),
      pedido: contexto.orderNumber,
      valor: formatBRL(contexto.totalCents),
      status: ORDER_STATUS_LABELS[contexto.status],
      telefone: formatarTelefone(contexto.phone),
      cashback: formatBRL(saldoCashbackCents),
      itens: formatarItens(contexto.items ?? []),
    });

    return this.enviar(event, contexto, mensagem);
  }

  /**
   * Saldo de cashback para o placeholder `{cashback}`. Reaproveita
   * `CashbackService.saldoPorTelefone` — mesma consulta que o checkout
   * usa, nenhuma regra de cashback duplicada aqui.
   *
   * Nunca deixa a notificacao inteira falhar por causa disto: se a
   * consulta der erro, loga e segue com R$ 0,00 — mensagem continua
   * saindo, so sem o saldo certo desta vez.
   */
  private async obterSaldoCashback(storeId: string, phone: string): Promise<number> {
    try {
      const saldo = await this.cashback.saldoPorTelefone(storeId, phone);
      return saldo.totalCents;
    } catch (error) {
      this.logger.error('Falha ao consultar saldo de cashback para notificacao', error as Error);
      return 0;
    }
  }

  private async enviar(
    event: NotificationEvent,
    contexto: OrderNotificationContext,
    mensagem: string,
  ): Promise<NotificationResult> {
    const provider = this.provider!;
    const telefoneInternacional = paraFormatoInternacional(contexto.phone!);
    const destinatario = mascararTelefone(telefoneInternacional);
    const iniciadoEm = Date.now();

    const resultado = await provider.sendText(telefoneInternacional, mensagem);

    this.logger.log(
      JSON.stringify({
        evento: resultado.success ? 'notificacao.enviada' : 'notificacao.falhou',
        pedido: contexto.orderNumber,
        tipo: event,
        provedor: provider.nome,
        destinatario,
        duracaoMs: Date.now() - iniciadoEm,
        ...(resultado.success
          ? { messageId: resultado.externalId ?? null }
          : { erro: resultado.error }),
      }),
    );

    await this.prisma.notificationLog.create({
      data: {
        storeId: contexto.storeId,
        orderId: contexto.orderId,
        event,
        provider: provider.nome,
        success: resultado.success,
        errorMessage: resultado.success ? null : (resultado.error?.slice(0, 500) ?? null),
      },
    });

    return {
      enviado: resultado.success,
      simulado: false,
      ...(resultado.error ? { motivo: resultado.error } : {}),
    };
  }
}
