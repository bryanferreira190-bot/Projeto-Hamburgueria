import { describe, expect, it, vi } from 'vitest';
import { WhatsAppService } from './whatsapp.service';
import { mascararTelefone, paraFormatoInternacional, sanitizarPayload } from './whatsapp.utils';
import { classificarErro, erroDeRede } from './whatsapp.errors';
import { TEMPLATES } from './whatsapp.templates';
import type { MetaGraphClient } from './meta-graph.client';
import type { Env } from '../../config/env';

/**
 * O que estes testes protegem: o interruptor (nada pode escapar para a
 * Meta com WHATSAPP_ENABLED=false), a distincao entre sucesso real e
 * simulado (carimbar envio que nao aconteceu e mentir para o proprio
 * sistema) e a decisao de repetir ou nao cada erro.
 */

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    WHATSAPP_ENABLED: false,
    WHATSAPP_ACCESS_TOKEN: '',
    WHATSAPP_PHONE_NUMBER_ID: '',
    WHATSAPP_API_VERSION: 'v23.0',
    ...overrides,
  } as Env;
}

function makeService(env: Env, respostaDaMeta?: unknown) {
  const post = vi.fn().mockResolvedValue(
    respostaDaMeta ?? {
      ok: true,
      dados: { messages: [{ id: 'wamid.TESTE' }] },
      erro: null,
      duracaoMs: 120,
      tentativas: 1,
    },
  );

  const meta = { post } as unknown as MetaGraphClient;
  return { service: new WhatsAppService(meta, env), post };
}

const LIGADO = makeEnv({
  WHATSAPP_ENABLED: true,
  WHATSAPP_ACCESS_TOKEN: 'token-de-verdade',
  WHATSAPP_PHONE_NUMBER_ID: '123456',
});

describe('WhatsAppService — interruptor', () => {
  it('desligado: NAO chama a Meta e devolve sucesso simulado', async () => {
    const { service, post } = makeService(makeEnv());

    const resultado = await service.sendText('11970706978', 'oi');

    expect(post).not.toHaveBeenCalled();
    expect(resultado).toEqual({ enviado: true, simulado: true, messageId: null });
  });

  it('ligado mas sem credencial: continua simulando em vez de falhar a cada envio', async () => {
    const { service, post } = makeService(makeEnv({ WHATSAPP_ENABLED: true }));

    const resultado = await service.sendText('11970706978', 'oi');

    expect(post).not.toHaveBeenCalled();
    expect(resultado.simulado).toBe(true);
    expect(service.ativo).toBe(false);
  });

  it('ligado e com credencial: envia de verdade e devolve o id da Meta', async () => {
    const { service, post } = makeService(LIGADO);

    const resultado = await service.sendText('11970706978', 'oi');

    expect(post).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ enviado: true, simulado: false, messageId: 'wamid.TESTE' });
  });

  it('a rota de envio inclui o phone number id configurado', async () => {
    const { service, post } = makeService(LIGADO);

    await service.sendText('11970706978', 'oi');

    expect(post.mock.calls[0]![0]).toBe('123456/messages');
  });
});

describe('WhatsAppService.sendTemplate', () => {
  it('monta o payload no formato que a Cloud API espera', async () => {
    const { service, post } = makeService(LIGADO);

    await service.sendTemplate('11970706978', 'PAGAMENTO_APROVADO', ['Joao', 'A012']);

    const payload = post.mock.calls[0]![1];
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'template',
      to: '5511970706978',
      template: {
        name: TEMPLATES.PAGAMENTO_APROVADO.nome,
        language: { code: 'pt_BR' },
      },
    });
    /* Variaveis sao POSICIONAIS: a ordem do array define {{1}}, {{2}}. */
    expect(payload.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Joao' },
      { type: 'text', text: 'A012' },
    ]);
  });

  it('recusa antes de chamar a Meta quando a quantidade de variaveis nao bate', async () => {
    const { service, post } = makeService(LIGADO);

    /* PAGAMENTO_APROVADO espera 2 variaveis; mandamos 1. */
    const resultado = await service.sendTemplate('11970706978', 'PAGAMENTO_APROVADO', ['Joao']);

    expect(post).not.toHaveBeenCalled();
    expect(resultado.enviado).toBe(false);
    expect(resultado.erro?.tipo).toBe('TEMPLATE_INVALIDO');
  });

  it('falha da Meta vira resultado com erro classificado, sem lancar excecao', async () => {
    const { service } = makeService(LIGADO, {
      ok: false,
      dados: null,
      erro: { tipo: 'DESTINATARIO_INVALIDO', mensagem: 'numero nao existe', podeRepetir: false },
      duracaoMs: 90,
      tentativas: 1,
    });

    const resultado = await service.sendTemplate('11970706978', 'ENTREGUE', ['Joao', 'A012']);

    expect(resultado.enviado).toBe(false);
    expect(resultado.erro?.tipo).toBe('DESTINATARIO_INVALIDO');
  });
});

describe('WhatsAppService — mensagens de negocio', () => {
  const ctx = { telefone: '11970706978', nomeDoCliente: 'Joao da Silva', numeroDoPedido: 'A012' };

  it('usa o primeiro nome, nao o nome completo', async () => {
    const { service, post } = makeService(LIGADO);

    await service.sendPreparing(ctx);

    expect(post.mock.calls[0]![1].template.components[0].parameters[0].text).toBe('Joao');
  });

  it('sem nome utilizavel, cai num tratamento neutro em vez de "null"', async () => {
    const { service, post } = makeService(LIGADO);

    await service.sendDelivered({ ...ctx, nomeDoCliente: null });

    expect(post.mock.calls[0]![1].template.components[0].parameters[0].text).toBe('Tudo bem');
  });

  it('cada metodo usa o template correspondente', async () => {
    const { service, post } = makeService(LIGADO);

    await service.sendOrderReceived(ctx, 'R$ 42,00');
    await service.sendPaymentApproved(ctx);
    await service.sendPaymentFailed(ctx);
    await service.sendOutForDelivery(ctx);

    const nomes = post.mock.calls.map((chamada) => chamada[1].template.name);
    expect(nomes).toEqual([
      TEMPLATES.PEDIDO_RECEBIDO.nome,
      TEMPLATES.PAGAMENTO_APROVADO.nome,
      TEMPLATES.PAGAMENTO_RECUSADO.nome,
      TEMPLATES.SAIU_PARA_ENTREGA.nome,
    ]);
  });
});

describe('paraFormatoInternacional', () => {
  it('acrescenta o 55 no telefone guardado so com DDD', () => {
    expect(paraFormatoInternacional('11970706978')).toBe('5511970706978');
  });

  it('nao duplica o 55 de quem ja veio internacional', () => {
    expect(paraFormatoInternacional('5511970706978')).toBe('5511970706978');
  });

  it('ignora mascara', () => {
    expect(paraFormatoInternacional('(11) 97070-6978')).toBe('5511970706978');
  });
});

describe('mascararTelefone', () => {
  it('esconde tudo menos os quatro ultimos digitos', () => {
    expect(mascararTelefone('5511970706978')).toBe('*********6978');
  });

  it('nao deixa vazar DDD nem prefixo — log nao precisa disso', () => {
    const mascarado = mascararTelefone('5511970706978');
    expect(mascarado).not.toContain('11');
    expect(mascarado).not.toContain('9707');
  });

  it('nao quebra com entrada curta demais', () => {
    expect(mascararTelefone('123')).toBe('***');
  });
});

describe('sanitizarPayload — log nunca leva dado pessoal', () => {
  it('mascara o telefone e troca o conteudo das variaveis por tamanho', () => {
    const saneado = sanitizarPayload({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511970706978',
      type: 'template',
      template: {
        name: 'pedido_entregue',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Joao' }, { type: 'text', text: 'A012' }] },
        ],
      },
    });

    const serializado = JSON.stringify(saneado);
    /* O que interessa depurar continua la... */
    expect(serializado).toContain('pedido_entregue');
    expect(serializado).toContain('6978');
    /* ...mas nome do cliente e telefone completo, nao. */
    expect(serializado).not.toContain('Joao');
    expect(serializado).not.toContain('5511970706978');
  });

  it('em texto livre, guarda so o tamanho — nunca o conteudo', () => {
    const saneado = sanitizarPayload({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511970706978',
      type: 'text',
      text: { body: 'mensagem secreta do cliente', preview_url: false },
    });

    expect(JSON.stringify(saneado)).not.toContain('secreta');
    expect(saneado.tamanhoDoTexto).toBe('mensagem secreta do cliente'.length);
  });
});

describe('classificarErro — repetir ou nao', () => {
  const erroCom = (code: number) => ({ error: { code, message: 'detalhe' } });

  it('token invalido nunca e repetido', () => {
    const erro = classificarErro(401, erroCom(190));
    expect(erro.tipo).toBe('CREDENCIAL_INVALIDA');
    expect(erro.podeRepetir).toBe(false);
  });

  it('acesso negado e credencial, nao indisponibilidade', () => {
    /* 131005 e "access denied" — falta permissao no System User.
       Tratar como indisponivel faria repetir 3x a toa e apontar o
       diagnostico para o lado errado. */
    const erro = classificarErro(403, erroCom(131005));
    expect(erro.tipo).toBe('CREDENCIAL_INVALIDA');
    expect(erro.podeRepetir).toBe(false);
  });

  it('numero da LOJA nao registrado nao e confundido com numero do cliente', () => {
    /* Toda a familia 133xxx e sobre o nosso numero. Classificar como
       problema do destinatario faria procurar defeito no telefone do
       cliente por horas. */
    const erro = classificarErro(400, erroCom(133010));
    expect(erro.tipo).toBe('CONFIGURACAO_INVALIDA');
    expect(erro.mensagem).toContain('NUMERO DA LOJA');
  });

  it('problema de faturamento tem mensagem propria, nao cai no generico', () => {
    const erro = classificarErro(400, erroCom(131042));
    expect(erro.tipo).toBe('CONFIGURACAO_INVALIDA');
    expect(erro.mensagem).toContain('pagamento');
  });

  it('limite da conta NAO e repetido — a janela e de horas, o backoff e de 1s', () => {
    expect(classificarErro(400, erroCom(80007)).podeRepetir).toBe(false);
    expect(classificarErro(429, erroCom(130429)).podeRepetir).toBe(false);
  });

  it('recusa por engajamento (marketing) tem tipo proprio e nao repete', () => {
    const erro = classificarErro(400, erroCom(131049));
    expect(erro.tipo).toBe('RECUSADO_PELA_META');
    expect(erro.podeRepetir).toBe(false);
  });

  it('numero que nao recebe no WhatsApp nao e repetido', () => {
    const erro = classificarErro(400, erroCom(131026));
    expect(erro.tipo).toBe('DESTINATARIO_INVALIDO');
    expect(erro.podeRepetir).toBe(false);
  });

  it('template reprovado nao e repetido', () => {
    const erro = classificarErro(400, erroCom(132007));
    expect(erro.tipo).toBe('TEMPLATE_INVALIDO');
    expect(erro.podeRepetir).toBe(false);
  });

  it('fora da janela de 24h e apontado explicitamente', () => {
    expect(classificarErro(400, erroCom(131047)).tipo).toBe('FORA_DA_JANELA');
  });

  it('5xx sem codigo conhecido vale nova tentativa', () => {
    const erro = classificarErro(503, null);
    expect(erro.tipo).toBe('INDISPONIVEL');
    expect(erro.podeRepetir).toBe(true);
  });

  it('429 sem codigo conhecido tambem vale nova tentativa', () => {
    expect(classificarErro(429, null).podeRepetir).toBe(true);
  });

  it('4xx desconhecido nao e repetido', () => {
    const erro = classificarErro(400, erroCom(999999));
    expect(erro.tipo).toBe('ERRO_DA_META');
    expect(erro.podeRepetir).toBe(false);
  });

  it('falha de rede vale nova tentativa', () => {
    expect(erroDeRede('timeout').podeRepetir).toBe(true);
  });
});

describe('catalogo de templates', () => {
  it('todo template declara quantas variaveis o exemplo usa', () => {
    for (const [chave, definicao] of Object.entries(TEMPLATES)) {
      const encontradas = new Set(definicao.exemplo.match(/\{\{\d+\}\}/g) ?? []);
      expect(
        encontradas.size,
        `${chave}: o texto de exemplo tem ${encontradas.size} variavel(is), mas declara ${definicao.variaveis}`,
      ).toBe(definicao.variaveis);
    }
  });

  it('a descricao das variaveis cobre todas elas', () => {
    for (const [chave, definicao] of Object.entries(TEMPLATES)) {
      expect(definicao.descricaoDasVariaveis.length, chave).toBe(definicao.variaveis);
    }
  });

  it('nomes de template sao unicos', () => {
    const nomes = Object.values(TEMPLATES).map((t) => t.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
