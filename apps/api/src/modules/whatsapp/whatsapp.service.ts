import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MetaGraphClient } from './meta-graph.client';
import { IDIOMA_DOS_TEMPLATES, TEMPLATES, type ChaveDeTemplate } from './whatsapp.templates';
import { mascararTelefone, paraFormatoInternacional, sanitizarPayload } from './whatsapp.utils';
import type {
  PayloadDeMensagem,
  PayloadDeTemplate,
  PayloadDeTexto,
  RespostaDeEnvio,
  ResultadoDeEnvio,
} from './whatsapp.types';

/** Dados minimos que toda mensagem sobre pedido precisa. */
export interface ContextoDePedido {
  telefone: string;
  nomeDoCliente: string | null;
  numeroDoPedido: string;
}

/**
 * ENVIO DE WHATSAPP PELA CLOUD API OFICIAL DA META
 *
 * Nao usamos bibliotecas nao oficiais (Baileys, Venom): elas violam os
 * termos do WhatsApp e levam a banimento do numero comercial — que e o
 * mesmo numero que a loja usa para atender. Decisao registrada em
 * ARQUITETURA.md desde o inicio do projeto.
 *
 * DESLIGADO POR PADRAO (WHATSAPP_ENABLED=false). Nesse estado nenhuma
 * chamada sai para a Meta: o servico registra no log exatamente o que
 * enviaria e devolve sucesso SIMULADO, para o resto do sistema seguir
 * funcionando normalmente. Ligar e so trocar a variavel de ambiente —
 * nenhuma linha de codigo muda.
 *
 * A distincao entre sucesso real e simulado fica em `simulado` no
 * resultado. Quem registra "aviso enviado" em algum lugar precisa olhar
 * esse campo: carimbar envio que nao aconteceu e mentir para o proprio
 * sistema, e o cliente nunca receberia a mensagem.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly meta: MetaGraphClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Se as mensagens saem de verdade.
   *
   * Exige o interruptor ligado E as credenciais presentes: ligar sem
   * credencial faria toda mensagem falhar em runtime, uma a uma, em vez
   * de simplesmente continuar simulando.
   */
  get ativo(): boolean {
    return Boolean(
      this.env.WHATSAPP_ENABLED &&
        this.env.WHATSAPP_ACCESS_TOKEN &&
        this.env.WHATSAPP_PHONE_NUMBER_ID,
    );
  }

  /* ============================================================
     ENVIO BRUTO
     ============================================================ */

  /**
   * Texto livre.
   *
   * SO funciona dentro da janela de 24h depois de o cliente ter mandado
   * mensagem. Fora dela, a Meta recusa (erro FORA_DA_JANELA) e o envio
   * precisa ser por template. Por isso, nenhum aviso automatico do
   * sistema usa este metodo — ele existe para resposta a conversa
   * iniciada pelo cliente.
   */
  async sendText(telefone: string, texto: string): Promise<ResultadoDeEnvio> {
    const payload: PayloadDeTexto = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: paraFormatoInternacional(telefone),
      type: 'text',
      /* preview_url false: link em aviso automatico virando card gigante
         atrapalha mais do que ajuda. */
      text: { body: texto, preview_url: false },
    };

    return this.enviar(payload, { descricao: 'texto livre' });
  }

  /**
   * Template aprovado — o unico caminho para mensagem iniciada pela
   * loja.
   *
   * A quantidade de variaveis e conferida contra o catalogo ANTES de
   * chamar a Meta: mandar a mais ou a menos gera um erro generico do
   * lado deles, dificil de rastrear. Falhar aqui aponta direto para o
   * lugar errado no codigo.
   */
  async sendTemplate(
    telefone: string,
    chave: ChaveDeTemplate,
    variaveis: string[],
  ): Promise<ResultadoDeEnvio> {
    const template = TEMPLATES[chave];

    if (variaveis.length !== template.variaveis) {
      const mensagem =
        `Template "${template.nome}" espera ${template.variaveis} variavel(is), ` +
        `recebeu ${variaveis.length}. Corrija a chamada ou o catalogo em whatsapp.templates.ts.`;
      this.logger.error(mensagem);
      return {
        enviado: false,
        simulado: false,
        messageId: null,
        erro: { tipo: 'TEMPLATE_INVALIDO', mensagem },
      };
    }

    const payload: PayloadDeTemplate = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: paraFormatoInternacional(telefone),
      type: 'template',
      template: {
        name: template.nome,
        language: { code: IDIOMA_DOS_TEMPLATES },
        components: variaveis.length
          ? [{ type: 'body', parameters: variaveis.map((texto) => ({ type: 'text', text: texto })) }]
          : [],
      },
    };

    return this.enviar(payload, { descricao: `template ${template.nome}` });
  }

  /* ============================================================
     MENSAGENS DE NEGOCIO
     ============================================================ */

  async sendOrderReceived(ctx: ContextoDePedido, totalFormatado: string): Promise<ResultadoDeEnvio> {
    return this.sendTemplate(ctx.telefone, 'PEDIDO_RECEBIDO', [
      primeiroNome(ctx.nomeDoCliente),
      ctx.numeroDoPedido,
      totalFormatado,
    ]);
  }

  async sendPaymentApproved(ctx: ContextoDePedido): Promise<ResultadoDeEnvio> {
    return this.sendTemplate(ctx.telefone, 'PAGAMENTO_APROVADO', [
      primeiroNome(ctx.nomeDoCliente),
      ctx.numeroDoPedido,
    ]);
  }

  async sendPaymentFailed(ctx: ContextoDePedido): Promise<ResultadoDeEnvio> {
    return this.sendTemplate(ctx.telefone, 'PAGAMENTO_RECUSADO', [
      primeiroNome(ctx.nomeDoCliente),
      ctx.numeroDoPedido,
    ]);
  }

  async sendPreparing(ctx: ContextoDePedido): Promise<ResultadoDeEnvio> {
    return this.sendTemplate(ctx.telefone, 'EM_PREPARO', [
      primeiroNome(ctx.nomeDoCliente),
      ctx.numeroDoPedido,
    ]);
  }

  async sendOutForDelivery(ctx: ContextoDePedido): Promise<ResultadoDeEnvio> {
    return this.sendTemplate(ctx.telefone, 'SAIU_PARA_ENTREGA', [
      primeiroNome(ctx.nomeDoCliente),
      ctx.numeroDoPedido,
    ]);
  }

  async sendDelivered(ctx: ContextoDePedido): Promise<ResultadoDeEnvio> {
    return this.sendTemplate(ctx.telefone, 'ENTREGUE', [
      primeiroNome(ctx.nomeDoCliente),
      ctx.numeroDoPedido,
    ]);
  }

  /** Aviso de cashback prestes a vencer — ver CashbackExpiryJob. */
  async sendCashbackExpiring(
    telefone: string,
    nomeDoCliente: string | null,
    valorFormatado: string,
  ): Promise<ResultadoDeEnvio> {
    return this.sendTemplate(telefone, 'CASHBACK_EXPIRANDO', [
      primeiroNome(nomeDoCliente),
      valorFormatado,
    ]);
  }

  /* ============================================================
     INTERNO
     ============================================================ */

  private async enviar(
    payload: PayloadDeMensagem,
    contexto: { descricao: string },
  ): Promise<ResultadoDeEnvio> {
    const destinatario = mascararTelefone(payload.to);

    if (!this.ativo) {
      /* Desligado: registra o que sairia e devolve sucesso simulado, sem
         tocar na rede. E o que permite todo o resto do sistema rodar e
         ser testado antes de a conta Meta existir. */
      this.logger.log(
        JSON.stringify({
          evento: 'whatsapp.simulado',
          momento: new Date().toISOString(),
          destinatario,
          conteudo: contexto.descricao,
          motivo: this.env.WHATSAPP_ENABLED
            ? 'WHATSAPP_ENABLED=true, mas faltam credenciais'
            : 'WHATSAPP_ENABLED=false',
          payload: sanitizarPayload(payload),
        }),
      );
      return { enviado: true, simulado: true, messageId: null };
    }

    const resposta = await this.meta.post<RespostaDeEnvio>(
      `${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      payload,
    );

    const messageId = resposta.dados?.messages?.[0]?.id ?? null;

    /**
     * Log estruturado (JSON numa linha) para o Railway conseguir filtrar
     * por campo. O payload vai junto porque, quando uma mensagem chega
     * errada, o que foi enviado e a primeira coisa que se quer ver — mas
     * SANEADO: log e lido por mais gente e guardado por mais tempo que o
     * banco, e nao ha motivo para telefone e nome de cliente circularem
     * ali (ver auditoria de LGPD em DECISOES.md).
     */
    this.logger.log(
      JSON.stringify({
        evento: resposta.ok ? 'whatsapp.enviado' : 'whatsapp.falhou',
        momento: new Date().toISOString(),
        destinatario,
        conteudo: contexto.descricao,
        messageId,
        duracaoMs: resposta.duracaoMs,
        tentativas: resposta.tentativas,
        payload: sanitizarPayload(payload),
        ...(resposta.ok
          ? { resposta: resposta.dados }
          : { erro: resposta.erro?.tipo, detalhe: resposta.erro?.mensagem, codigo: resposta.erro?.codigo }),
      }),
    );

    if (!resposta.ok) {
      return {
        enviado: false,
        simulado: false,
        messageId: null,
        erro: {
          tipo: resposta.erro?.tipo ?? 'ERRO_DA_META',
          mensagem: resposta.erro?.mensagem ?? 'falha desconhecida',
          ...(resposta.erro?.codigo !== undefined ? { codigo: resposta.erro.codigo } : {}),
        },
      };
    }

    return { enviado: true, simulado: false, messageId };
  }
}

/** "Joao da Silva" -> "Joao". Sem nome utilizavel, um tratamento neutro. */
function primeiroNome(nome: string | null): string {
  const primeiro = nome?.trim().split(/\s+/)[0];
  return primeiro && primeiro.length > 1 ? primeiro : 'Tudo bem';
}
