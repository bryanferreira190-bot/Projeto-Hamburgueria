import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import type { ProviderHealth, ProviderSendResult, WhatsAppProvider } from './whatsapp-provider.interface';

/** Depois disso, desiste desta tentativa e classifica como indisponivel. */
const TIMEOUT_MS = 15_000;
const MAX_TENTATIVAS = 3;
/** Base do backoff exponencial: 500ms, 1000ms, 2000ms... */
const BACKOFF_BASE_MS = 500;

/**
 * PROVEDOR EVOLUTION API (BAILEYS)
 *
 * Implementacao concreta de WhatsAppProvider. Nao compartilha codigo com
 * meta-graph.client.ts (o cliente HTTP do modulo whatsapp/, que fala com
 * a Meta Cloud API) DE PROPOSITO: sao dois provedores genuinamente
 * independentes por tras da mesma interface, com autenticacao, formato
 * de corpo e taxonomia de erro proprios — forcar as duas implementacoes
 * a compartilhar uma base tecnica so criaria acoplamento entre coisas
 * que precisam poder mudar (ou sumir) sem se afetar. A pequena
 * duplicacao do laco de retry (~30 linhas, o mesmo padrao ja usado la)
 * e o preco aceito por isso.
 *
 * Timeout mais generoso que o da Meta (15s vs 10s) porque a instancia
 * roda no plano gratuito do Render, que hiberna e pode demorar para
 * acordar — ver o aviso do dono. Mesmo assim, o disparo e SEMPRE
 * fire-and-forget (nunca `await`ado por quem cria/atualiza pedido — ver
 * MessagingService), entao mesmo o pior caso (3 tentativas x 15s +
 * backoff, quase 1 minuto) nunca trava uma resposta HTTP do sistema.
 */
@Injectable()
export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  readonly nome = 'evolution';

  private readonly logger = new Logger(EvolutionWhatsAppProvider.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  async sendText(phone: string, message: string): Promise<ProviderSendResult> {
    const url = `${this.env.EVOLUTION_API_URL}/message/sendText/${this.env.EVOLUTION_INSTANCE}`;
    const corpo = { number: phone, text: message };

    let ultimoErro = 'nenhuma tentativa executada';

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const resultado = await this.tentarUmaVez(url, corpo);

      if (resultado.ok) {
        return { success: true, externalId: resultado.externalId };
      }

      ultimoErro = resultado.erro;

      if (!resultado.podeRepetir || tentativa === MAX_TENTATIVAS) break;

      const espera = BACKOFF_BASE_MS * 2 ** (tentativa - 1);
      const jitter = Math.random() * BACKOFF_BASE_MS;
      this.logger.warn(
        `Evolution respondeu com erro (tentativa ${tentativa}/${MAX_TENTATIVAS}): ${resultado.erro}; ` +
          `nova tentativa em ${Math.round(espera + jitter)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, espera + jitter));
    }

    return { success: false, error: ultimoErro };
  }

  /**
   * Sem endpoint dedicado de health documentado para toda versao da
   * Evolution, usa `GET /instance/connectionState/{instance}` — se a
   * instancia responder com `state: "open"`, esta conectada ao
   * WhatsApp. Qualquer erro (401, timeout, offline) vira "desconectado"
   * — o health-check e so para o painel mostrar 🟢/🔴, nunca deveria
   * lancar excecao para quem chama.
   */
  async checkHealth(): Promise<ProviderHealth> {
    const url = `${this.env.EVOLUTION_API_URL}/instance/connectionState/${this.env.EVOLUTION_INSTANCE}`;
    const controle = new AbortController();
    const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS);

    try {
      const resposta = await fetch(url, {
        method: 'GET',
        headers: { apikey: this.env.EVOLUTION_API_KEY ?? '' },
        signal: controle.signal,
      });

      if (!resposta.ok) {
        return { connected: false, detail: `HTTP ${resposta.status}` };
      }

      const dados = (await resposta.json().catch(() => null)) as {
        instance?: { state?: string };
        state?: string;
      } | null;
      const estado = dados?.instance?.state ?? dados?.state ?? 'desconhecido';

      return { connected: estado === 'open', detail: estado };
    } catch (error) {
      return { connected: false, detail: mensagemDeErro(error) };
    } finally {
      clearTimeout(alarme);
    }
  }

  private async tentarUmaVez(
    url: string,
    corpo: unknown,
  ): Promise<{ ok: true; externalId: string | null } | { ok: false; erro: string; podeRepetir: boolean }> {
    /* AbortController: fetch nativo nao tem opcao de timeout — sem isso,
       uma chamada pendurada por causa do Render acordando devagar
       ficaria presa ate o SO desistir sozinho, bem depois do que faz
       sentido esperar aqui. */
    const controle = new AbortController();
    const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS);

    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: this.env.EVOLUTION_API_KEY ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
        signal: controle.signal,
      });

      const texto = await resposta.text();

      /* Parse isolado: um proxy do Render fora do ar devolve HTML, e um
         JSON.parse estourando aqui viraria "erro de rede" (repetivel),
         escondendo um 4xx que nunca vai passar. */
      let json: unknown = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        return classificarPorStatus(resposta.status, `resposta nao-JSON (HTTP ${resposta.status})`);
      }

      if (!resposta.ok) {
        const mensagem = extrairMensagemDeErro(json) ?? `HTTP ${resposta.status}`;
        return classificarPorStatus(resposta.status, mensagem);
      }

      const externalId = extrairId(json);
      return { ok: true, externalId };
    } catch (error) {
      /* AbortError (timeout) e falha de conexao (Evolution offline,
         Render dormindo, DNS) caem aqui — sempre transitorio, sempre
         vale repetir. */
      const motivo =
        error instanceof Error && error.name === 'AbortError'
          ? `sem resposta em ${TIMEOUT_MS}ms (Evolution pode estar acordando)`
          : mensagemDeErro(error);
      return { ok: false, erro: motivo, podeRepetir: true };
    } finally {
      clearTimeout(alarme);
    }
  }
}

/**
 * 401 (chave errada) e 404 (instancia/rota inexistente) nunca mudam
 * numa proxima tentativa — repetir so demoraria mais para reportar o
 * problema certo. 5xx e 400 genérico (a Evolution costuma devolver 400
 * quando a instancia esta desconectada do WhatsApp) sao tratados como
 * transitorios: melhor gastar uma tentativa a mais do que desistir de
 * um envio que passaria assim que a instancia reconectar sozinha.
 */
function classificarPorStatus(
  status: number,
  mensagem: string,
): { ok: false; erro: string; podeRepetir: boolean } {
  const podeRepetir = status !== 401 && status !== 404;
  return { ok: false, erro: `${mensagem} (HTTP ${status})`, podeRepetir };
}

function extrairMensagemDeErro(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const objeto = corpo as Record<string, unknown>;
  const mensagem = objeto.message ?? objeto.error ?? objeto.response;
  if (typeof mensagem === 'string') return mensagem;
  if (Array.isArray(mensagem)) return mensagem.filter((m) => typeof m === 'string').join('; ');
  return null;
}

function extrairId(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const objeto = corpo as Record<string, unknown>;
  const key = objeto.key as Record<string, unknown> | undefined;
  const id = key?.id;
  return typeof id === 'string' ? id : null;
}

function mensagemDeErro(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
