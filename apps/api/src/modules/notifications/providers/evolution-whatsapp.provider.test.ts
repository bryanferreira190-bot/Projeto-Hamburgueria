import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvolutionWhatsAppProvider } from './evolution-whatsapp.provider';
import type { Env } from '../../../config/env';

/**
 * Mesma logica de retry/backoff/timeout do MetaGraphClient (ver
 * meta-graph.client.test.ts), reimplementada aqui porque as duas
 * implementacoes nao compartilham codigo (ver o comentario no topo do
 * provider). A invariante central e a mesma: so repete o que adianta
 * repetir, e nunca deixa a excecao subir para quem chama.
 */

const ENV = {
  EVOLUTION_API_URL: 'https://evolution.example.com',
  EVOLUTION_API_KEY: 'chave-secreta',
  EVOLUTION_INSTANCE: 'adventure-burguer',
} as Env;

class AbortErrorLike extends Error {
  override readonly name = 'AbortError';
}

function respostaOk(corpo: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(corpo)),
  } as Response;
}

function respostaErro(status: number, corpo: unknown = { message: 'falhou' }) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify(corpo)),
  } as Response;
}

describe('EvolutionWhatsAppProvider.sendText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function comTemporizadores<T>(promessa: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return promessa;
  }

  it('acerto de primeira: uma chamada, sem erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({ key: { id: 'wamid-1' } }));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ success: true, externalId: 'wamid-1' });
  });

  it('manda numero e texto no corpo, e a apikey no cabecalho', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk({}));
    vi.stubGlobal('fetch', fetchMock);

    await comTemporizadores(new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'));

    const [url, opcoes] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://evolution.example.com/message/sendText/adventure-burguer');
    expect(opcoes.method).toBe('POST');
    expect(opcoes.headers.apikey).toBe('chave-secreta');
    expect(JSON.parse(opcoes.body)).toEqual({ number: '5511970706978', text: 'oi' });
  });

  it('401 (chave invalida) nao repete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(401));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado.success).toBe(false);
  });

  it('404 (instancia inexistente) nao repete', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(404));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado.success).toBe(false);
  });

  it('500 repete ate o limite de 3 tentativas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(500));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resultado.success).toBe(false);
  });

  it('para de repetir assim que uma tentativa da certo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaErro(500))
      .mockResolvedValueOnce(respostaOk({ key: { id: 'wamid-2' } }));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resultado).toEqual({ success: true, externalId: 'wamid-2' });
  });

  it('timeout (AbortError) conta como transitorio e repete', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new AbortErrorLike('aborted'))
      .mockResolvedValueOnce(respostaOk({ key: { id: 'wamid-3' } }));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resultado.success).toBe(true);
  });

  it('resposta nao-JSON com status de erro preserva o status, sem virar erro de rede indefinido', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('<html>proxy fora do ar</html>'),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    /* 401 nao e repetivel mesmo sem JSON — so uma chamada. */
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultado.success).toBe(false);
  });

  it('conexao recusada (Evolution/Render fora do ar) e transitoria e repete', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await comTemporizadores(
      new EvolutionWhatsAppProvider(ENV).sendText('5511970706978', 'oi'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resultado.success).toBe(false);
  });
});

describe('EvolutionWhatsAppProvider.checkHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('instancia conectada (state: open) reporta connected: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ instance: { state: 'open' } }),
      } as Response),
    );

    const resultado = await new EvolutionWhatsAppProvider(ENV).checkHealth();

    expect(resultado).toEqual({ connected: true, detail: 'open' });
  });

  it('instancia desconectada (state diferente de open) reporta connected: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ instance: { state: 'close' } }),
      } as Response),
    );

    const resultado = await new EvolutionWhatsAppProvider(ENV).checkHealth();

    expect(resultado).toEqual({ connected: false, detail: 'close' });
  });

  it('HTTP de erro (ex.: 401) reporta connected: false sem lancar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));

    const resultado = await new EvolutionWhatsAppProvider(ENV).checkHealth();

    expect(resultado).toEqual({ connected: false, detail: 'HTTP 401' });
  });

  it('erro de rede (Evolution fora do ar) reporta connected: false sem lancar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const resultado = await new EvolutionWhatsAppProvider(ENV).checkHealth();

    expect(resultado.connected).toBe(false);
    expect(resultado.detail).toBe('fetch failed');
  });
});
