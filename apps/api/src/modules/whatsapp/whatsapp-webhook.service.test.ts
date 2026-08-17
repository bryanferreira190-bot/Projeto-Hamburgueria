import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import type { Env } from '../../config/env';

/**
 * Codigo de seguranca sem teste e codigo de seguranca que ninguem
 * garante. Estes testes fixam o comportamento que impede alguem de
 * forjar "mensagem entregue" batendo na URL publica do webhook.
 */

const SEGREDO = 'segredo-do-app';

function makeService(overrides: Partial<Env> = {}) {
  return new WhatsAppWebhookService({
    WHATSAPP_APP_SECRET: SEGREDO,
    WHATSAPP_VERIFY_TOKEN: 'token-combinado',
    ...overrides,
  } as Env);
}

function assinar(corpo: string, segredo = SEGREDO): string {
  return `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`;
}

describe('verificacao do webhook (hub.challenge)', () => {
  it('devolve o challenge quando o token confere', () => {
    const resposta = makeService().verificarAssinatura('subscribe', 'token-combinado', 'DESAFIO');
    expect(resposta).toBe('DESAFIO');
  });

  it('recusa token errado', () => {
    expect(makeService().verificarAssinatura('subscribe', 'errado', 'DESAFIO')).toBeNull();
  });

  it('recusa modo diferente de subscribe', () => {
    expect(makeService().verificarAssinatura('unsubscribe', 'token-combinado', 'X')).toBeNull();
  });

  it('recusa quando nenhum token foi configurado — nao pode passar por omissao', () => {
    const serv = makeService({ WHATSAPP_VERIFY_TOKEN: '' });
    expect(serv.verificarAssinatura('subscribe', '', 'DESAFIO')).toBeNull();
  });
});

describe('assinatura HMAC do webhook', () => {
  const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('aceita assinatura valida', () => {
    expect(makeService().assinaturaConfere(corpo, assinar(corpo))).toBe(true);
  });

  it('recusa corpo adulterado, mesmo com assinatura bem formada', () => {
    const assinatura = assinar(corpo);
    const adulterado = corpo.replace('whatsapp_business_account', 'outra_coisa');
    expect(makeService().assinaturaConfere(adulterado, assinatura)).toBe(false);
  });

  it('recusa assinatura feita com outro segredo', () => {
    expect(makeService().assinaturaConfere(corpo, assinar(corpo, 'segredo-errado'))).toBe(false);
  });

  it('FALHA FECHADA sem APP_SECRET configurado', () => {
    /* Sem segredo nao ha como conferir nada. Aceitar seria abrir a
       porta para qualquer um forjar evento. */
    const serv = makeService({ WHATSAPP_APP_SECRET: '' });
    expect(serv.assinaturaConfere(corpo, assinar(corpo))).toBe(false);
  });

  it('recusa cabecalho ausente', () => {
    expect(makeService().assinaturaConfere(corpo, undefined)).toBe(false);
  });

  it('recusa cabecalho sem o prefixo sha256=', () => {
    const semPrefixo = assinar(corpo).replace('sha256=', '');
    expect(makeService().assinaturaConfere(corpo, semPrefixo)).toBe(false);
  });

  it('recusa assinatura de tamanho errado sem lancar excecao', () => {
    /* timingSafeEqual explode com buffers de tamanhos diferentes — a
       checagem de tamanho precisa vir antes. */
    expect(() => makeService().assinaturaConfere(corpo, 'sha256=abcd')).not.toThrow();
    expect(makeService().assinaturaConfere(corpo, 'sha256=abcd')).toBe(false);
  });

  it('recusa hex invalido sem lancar excecao', () => {
    expect(() => makeService().assinaturaConfere(corpo, 'sha256=zzzz')).not.toThrow();
  });
});

describe('processamento de eventos', () => {
  it('conta status e mensagens recebidas', () => {
    const resumo = makeService().processar({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: 'w1', status: 'delivered', timestamp: '1', recipient_id: '5511970706978' },
                  { id: 'w2', status: 'read', timestamp: '2', recipient_id: '5511970706978' },
                ],
                messages: [
                  { from: '5511970706978', id: 'm1', timestamp: '3', type: 'text' },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(resumo).toEqual({ statuses: 2, mensagens: 1 });
  });

  it('corpo vazio ou desconhecido nao quebra', () => {
    expect(makeService().processar({})).toEqual({ statuses: 0, mensagens: 0 });
    expect(makeService().processar({ entry: [{ id: '1' }] })).toEqual({
      statuses: 0,
      mensagens: 0,
    });
  });

  it('status de falha nao interrompe o processamento dos demais', () => {
    const resumo = makeService().processar({
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: 'w1',
                    status: 'failed',
                    timestamp: '1',
                    recipient_id: '5511970706978',
                    errors: [{ code: 131026, title: 'nao entregavel' }],
                  },
                  { id: 'w2', status: 'sent', timestamp: '2', recipient_id: '5511970706978' },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(resumo.statuses).toBe(2);
  });
});
