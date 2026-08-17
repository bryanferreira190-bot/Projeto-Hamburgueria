import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaGraphClient } from './meta-graph.client';
import type { Env } from '../../config/env';

/**
 * O cliente HTTP concentra retry, backoff e timeout — a parte que mais
 * silenciosamente pode gastar chamada a toa ou pendurar um job. Estes
 * testes fixam a invariante central: SO repete o que adianta repetir.
 */

const ENV = {
  WHATSAPP_ACCESS_TOKEN: 'token',
  WHATSAPP_API_VERSION: 'v23.0',
} as Env;

function respostaOk(corpo: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(corpo)),
  } as Response;
}

function respostaErro(status: number, code?: number) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify({ error: { code, message: 'falhou' } })),
  } as Response;
}

describe('MetaGraphClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Roda a promessa deixando os setTimeout do backoff dispararem. */
  async function comTemporizadores<T>(promessa: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return promessa;
  }

  it('monta a URL com a versao configurada', () => {
    const client = new MetaGraphClient(ENV);
    expect(client.urlDe('123/messages')).toBe('https://graph.facebook.com/v23.0/123/messages');
  });

  it('acerto de primeira: uma chamada e tentativas = 1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ messages: [{ id: 'x' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', {}));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado.ok).toBe(true);
    expect(resultado.tentativas).toBe(1);
  });

  it('erro NAO repetivel chama a Meta uma unica vez', async () => {
    /* 190 = token invalido. Repetir daria exatamente a mesma resposta. */
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(401, 190));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', {}));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado.erro?.tipo).toBe('CREDENCIAL_INVALIDA');
  });

  it('erro nao repetivel reporta o numero REAL de tentativas, nao o maximo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaErro(401, 190)));

    const resultado = await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', {}));

    /* Reportar 3 aqui esconderia justamente o que se quer diagnosticar
       no log: "esse erro esta queimando tentativa a toa?". */
    expect(resultado.tentativas).toBe(1);
  });

  it('erro repetivel tenta ate o limite e reporta quantas gastou', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(500));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', {}));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resultado.tentativas).toBe(3);
    expect(resultado.erro?.tipo).toBe('INDISPONIVEL');
  });

  it('para de repetir assim que uma tentativa da certo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaErro(503))
      .mockResolvedValueOnce(respostaOk({ messages: [{ id: 'x' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', {}));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resultado.ok).toBe(true);
    expect(resultado.tentativas).toBe(2);
  });

  it('envia o token no cabecalho Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({}));
    vi.stubGlobal('fetch', fetchMock);

    await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', { a: 1 }));

    const opcoes = fetchMock.mock.calls[0]![1];
    expect(opcoes.headers.Authorization).toBe('Bearer token');
    expect(opcoes.method).toBe('POST');
  });

  it('resposta nao-JSON com status de erro preserva o status, sem virar erro de rede', async () => {
    /* Proxy quebrado devolvendo HTML: tratar como falha de rede faria
       repetir um 4xx que nunca vai passar. */
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('<html>erro do proxy</html>'),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', {}));

    expect(resultado.erro?.podeRepetir).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erro lancado que nao e Error nao derruba o cliente', async () => {
    /* Um throw de valor primitivo faria o acesso a .message estourar
       DENTRO do catch, e a excecao subiria ate o job de quem chamou. */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue('falha crua'),
    );

    const resultado = await comTemporizadores(new MetaGraphClient(ENV).post('123/messages', {}));

    expect(resultado.ok).toBe(false);
    expect(resultado.erro?.tipo).toBe('INDISPONIVEL');
  });
});
