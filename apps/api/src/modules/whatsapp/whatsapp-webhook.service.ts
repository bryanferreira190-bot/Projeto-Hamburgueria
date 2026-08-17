import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { mascararTelefone } from './whatsapp.utils';
import type { CorpoDoWebhook, StatusRecebido } from './whatsapp.types';

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Responde ao desafio de verificacao da Meta.
   *
   * Acontece uma vez, quando o webhook e cadastrado no painel: a Meta
   * chama a URL com um token combinado e espera o `hub.challenge` de
   * volta em texto puro. Se nao bater, a assinatura nao e ativada.
   *
   * Devolve null quando o token nao confere — o controller transforma
   * isso em 403.
   */
  verificarAssinatura(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
    const esperado = this.env.WHATSAPP_VERIFY_TOKEN;

    if (!esperado) {
      this.logger.error(
        'Webhook chamado para verificacao, mas WHATSAPP_VERIFY_TOKEN nao esta configurado.',
      );
      return null;
    }

    if (mode !== 'subscribe' || token !== esperado || !challenge) {
      this.logger.warn(`Verificacao de webhook recusada (mode=${mode ?? 'ausente'})`);
      return null;
    }

    this.logger.log('Webhook verificado pela Meta com sucesso');
    return challenge;
  }

  /**
   * Confere que o corpo veio mesmo da Meta.
   *
   * SEM ISSO, qualquer um que descobrisse a URL poderia mandar "mensagem
   * entregue" ou "mensagem lida" falso — e, se um dia o webhook passar a
   * disparar acao de negocio, mandaria o sistema agir com base em dado
   * inventado. Mesmo raciocinio da validacao de assinatura que o webhook
   * do Mercado Pago ja faz.
   *
   * A Meta assina com HMAC-SHA256 do corpo BRUTO usando o App Secret.
   * Comparacao em tempo constante para nao vazar, pelo tempo de
   * resposta, quantos bytes bateram.
   */
  assinaturaConfere(corpoBruto: string, assinatura: string | undefined): boolean {
    const segredo = this.env.WHATSAPP_APP_SECRET;

    if (!segredo) {
      this.logger.error(
        'Webhook recebido, mas WHATSAPP_APP_SECRET nao esta configurado — recusando por seguranca.',
      );
      return false;
    }

    if (!assinatura?.startsWith('sha256=')) {
      this.logger.warn('Webhook sem cabecalho X-Hub-Signature-256 valido');
      return false;
    }

    const esperado = createHmac('sha256', segredo).update(corpoBruto, 'utf8').digest('hex');
    const recebido = assinatura.slice('sha256='.length);

    /* timingSafeEqual exige buffers do mesmo tamanho — tamanho
       diferente ja e assinatura invalida. */
    const bufEsperado = Buffer.from(esperado, 'hex');
    const bufRecebido = Buffer.from(recebido, 'hex');
    if (bufEsperado.length !== bufRecebido.length) return false;

    return timingSafeEqual(bufEsperado, bufRecebido);
  }

  /**
   * Processa a notificacao ja autenticada.
   *
   * Hoje so registra: a loja acompanha pedido pelo painel, nao por
   * resposta de WhatsApp, e nenhuma acao de negocio depende disto. O
   * valor agora e diagnostico — saber que a mensagem chegou, foi lida
   * ou falhou, e por que. Quando existir atendimento pelo WhatsApp,
   * `messages` e o gancho para responder dentro da janela de 24h.
   */
  processar(corpo: CorpoDoWebhook): { statuses: number; mensagens: number } {
    let statuses = 0;
    let mensagens = 0;

    for (const entrada of corpo.entry ?? []) {
      for (const mudanca of entrada.changes ?? []) {
        for (const status of mudanca.value.statuses ?? []) {
          statuses += 1;
          this.registrarStatus(status);
        }

        for (const mensagem of mudanca.value.messages ?? []) {
          mensagens += 1;
          this.logger.log(
            JSON.stringify({
              evento: 'whatsapp.mensagem_recebida',
              de: mascararTelefone(mensagem.from),
              tipo: mensagem.type,
              momento: new Date().toISOString(),
            }),
          );
        }
      }
    }

    return { statuses, mensagens };
  }

  private registrarStatus(status: StatusRecebido): void {
    const base = {
      evento: 'whatsapp.status',
      messageId: status.id,
      status: status.status,
      destinatario: mascararTelefone(status.recipient_id),
      momento: new Date().toISOString(),
    };

    if (status.status === 'failed') {
      /* Falha e o unico status que merece nivel de erro: e o caso em que
         o cliente NAO recebeu, e alguem pode precisar agir. */
      this.logger.error(
        JSON.stringify({ ...base, erros: status.errors?.map((e) => `${e.code}: ${e.title}`) }),
      );
      return;
    }

    this.logger.log(JSON.stringify(base));
  }
}
