import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { classificarErro, erroDeRede, type ErroClassificado } from './whatsapp.errors';
import type { ErroDaMeta } from './whatsapp.types';

export interface RespostaDaMeta<T> {
  ok: boolean;
  dados: T | null;
  erro: ErroClassificado | null;
  /** Quanto a chamada demorou, em ms. Entra no log estruturado. */
  duracaoMs: number;
  /** Quantas tentativas foram gastas (1 = acertou de primeira). */
  tentativas: number;
}

/** Depois disso, desiste e devolve INDISPONIVEL. */
const TIMEOUT_MS = 10_000;
const MAX_TENTATIVAS = 3;
/** Base do backoff exponencial: 400ms, 800ms, 1600ms... */
const BACKOFF_BASE_MS = 400;

/**
 * CLIENTE HTTP DA GRAPH API DA META
 *
 * Camada fina e sem regra de negocio: sabe montar a URL versionada,
 * autenticar, respeitar timeout, repetir o que vale a pena repetir e
 * traduzir erro. Nao sabe o que e pedido, cliente ou cashback.
 *
 * Separado do WhatsAppService de proposito: quando um dia entrar outra
 * chamada a Graph API (consultar status de template, listar numeros da
 * conta), ela reaproveita este cliente em vez de repetir timeout,
 * retry e tratamento de erro.
 *
 * Usa fetch nativo em vez de axios/@nestjs/axios: o projeto ja fala com
 * o Mercado Pago assim, o Node 20+ tem fetch de fabrica, e uma
 * dependencia a menos e uma dependencia a menos para auditar.
 */
@Injectable()
export class MetaGraphClient {
  private readonly logger = new Logger(MetaGraphClient.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** URL completa de um recurso, ja com a versao configurada. */
  urlDe(caminho: string): string {
    const versao = this.env.WHATSAPP_API_VERSION;
    return `https://graph.facebook.com/${versao}/${caminho.replace(/^\/+/, '')}`;
  }

  /**
   * POST autenticado, com retry exponencial no que for transitorio.
   *
   * So repete erro marcado como `podeRepetir` (limite de envio, queda
   * de rede, 5xx). Token invalido e template reprovado nao sao
   * repetidos: a resposta seria identica e o unico efeito seria demorar
   * mais para reportar o problema.
   */
  async post<T>(caminho: string, corpo: unknown): Promise<RespostaDaMeta<T>> {
    const url = this.urlDe(caminho);
    const iniciadoEm = Date.now();

    let ultimoErro: ErroClassificado = erroDeRede('nenhuma tentativa executada');
    /* Fora do laco: o `return` de erro esta depois dele e precisa saber
       quantas tentativas foram realmente gastas. Reportar sempre o
       maximo esconderia justamente o que interessa diagnosticar —
       "esse erro esta queimando 3 chamadas a toa?". */
    let tentativasGastas = 0;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      tentativasGastas = tentativa;
      const resultado = await this.tentarUmaVez<T>(url, corpo);

      if (resultado.ok) {
        return {
          ok: true,
          dados: resultado.dados,
          erro: null,
          duracaoMs: Date.now() - iniciadoEm,
          tentativas: tentativa,
        };
      }

      ultimoErro = resultado.erro;

      if (!resultado.erro.podeRepetir || tentativa === MAX_TENTATIVAS) break;

      /* Backoff exponencial com jitter: sem o jitter, varios envios que
         falharam juntos voltariam todos no mesmo instante e bateriam no
         mesmo limite de novo. */
      const espera = BACKOFF_BASE_MS * 2 ** (tentativa - 1);
      const jitter = Math.random() * BACKOFF_BASE_MS;
      this.logger.warn(
        `Meta respondeu ${resultado.erro.tipo} (tentativa ${tentativa}/${MAX_TENTATIVAS}); ` +
          `nova tentativa em ${Math.round(espera + jitter)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, espera + jitter));
    }

    return {
      ok: false,
      dados: null,
      erro: ultimoErro,
      duracaoMs: Date.now() - iniciadoEm,
      tentativas: tentativasGastas,
    };
  }

  private async tentarUmaVez<T>(
    url: string,
    corpo: unknown,
  ): Promise<{ ok: true; dados: T } | { ok: false; erro: ErroClassificado }> {
    /* AbortController porque o fetch nativo nao tem opcao de timeout:
       sem isso, uma chamada pendurada seguraria o job diario para
       sempre. */
    const controle = new AbortController();
    const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS);

    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
        signal: controle.signal,
      });

      const texto = await resposta.text();

      /* Parse isolado: proxy/balanceador com problema devolve HTML, e um
         JSON.parse estourando aqui viraria "erro de rede" (repetivel),
         escondendo um 4xx que nunca vai passar. Preserva o status. */
      let json: unknown = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        if (!resposta.ok) return { ok: false, erro: classificarErro(resposta.status, null) };
        return { ok: false, erro: erroDeRede(`resposta nao-JSON (HTTP ${resposta.status})`) };
      }

      if (!resposta.ok) {
        return { ok: false, erro: classificarErro(resposta.status, json as ErroDaMeta) };
      }

      return { ok: true, dados: json as T };
    } catch (error) {
      /* `error instanceof Error` e nao cast: um throw de valor primitivo
         faria o acesso a .message estourar DENTRO do catch, e a excecao
         subiria ate derrubar o laco de quem chamou. */
      const motivo =
        error instanceof Error
          ? error.name === 'AbortError'
            ? `sem resposta em ${TIMEOUT_MS}ms`
            : error.message
          : String(error);
      return { ok: false, erro: erroDeRede(motivo) };
    } finally {
      clearTimeout(alarme);
    }
  }
}
