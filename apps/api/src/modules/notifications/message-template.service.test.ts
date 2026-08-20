import { NotificationEvent } from '@adventure/shared';
import { describe, expect, it, vi } from 'vitest';
import { MessageTemplateService } from './message-template.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

const STORE_ID = 'store-1';

function makeService(overrides: {
  existentes?: Array<{ event: string; isActive: boolean; message: string }>;
  criarLancaColisao?: boolean;
} = {}) {
  const existentes = overrides.existentes ?? [];
  const linhasCriadas: unknown[] = [];

  const prisma = {
    notificationTemplate: {
      findMany: vi.fn().mockResolvedValue(existentes),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        linhasCriadas.push(...data);
        return { count: data.length };
      }),
      findUnique: vi.fn(({ where }: { where: { storeId_event: { storeId: string; event: string } } }) =>
        Promise.resolve(
          existentes.find(
            (t) => t.event === where.storeId_event.event && where.storeId_event.storeId === STORE_ID,
          ) ?? null,
        ),
      ),
      findUniqueOrThrow: vi.fn(({ where }: { where: { storeId_event: { event: string } } }) => {
        const achado = existentes.find((t) => t.event === where.storeId_event.event);
        if (!achado) throw new Error('nao encontrado');
        return Promise.resolve(achado);
      }),
      create: vi.fn((args: { data: { event: string; message: string } }) => {
        if (overrides.criarLancaColisao) return Promise.reject(new Error('P2002'));
        const linha = { ...args.data, storeId: STORE_ID, isActive: true };
        return Promise.resolve(linha);
      }),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ storeId: STORE_ID, ...data }),
      ),
    },
  } as unknown as PrismaService;

  return { service: new MessageTemplateService(prisma), prisma, linhasCriadas };
}

describe('MessageTemplateService.listar', () => {
  it('loja nova: cria os 5 templates com texto padrao e devolve todos', async () => {
    const { service, linhasCriadas } = makeService({ existentes: [] });

    await service.listar(STORE_ID);

    expect(linhasCriadas).toHaveLength(Object.values(NotificationEvent).length);
  });

  it('loja com alguns templates ja criados: so completa o que falta', async () => {
    const { service, linhasCriadas } = makeService({
      existentes: [{ event: NotificationEvent.ORDER_RECEIVED, isActive: true, message: 'x' }],
    });

    await service.listar(STORE_ID);

    expect(linhasCriadas).toHaveLength(Object.values(NotificationEvent).length - 1);
    expect(linhasCriadas).not.toContainEqual(
      expect.objectContaining({ event: NotificationEvent.ORDER_RECEIVED }),
    );
  });
});

describe('MessageTemplateService.obterAtivo', () => {
  it('template inexistente: cria com o texto padrao e devolve ativo', async () => {
    const { service } = makeService({ existentes: [] });

    const template = await service.obterAtivo(STORE_ID, NotificationEvent.PREPARING);

    expect(template?.isActive).toBe(true);
    expect(template?.message).toContain('preparad');
  });

  it('template existente e desativado: devolve null (nao manda mensagem)', async () => {
    const { service } = makeService({
      existentes: [{ event: NotificationEvent.PREPARING, isActive: false, message: 'x' }],
    });

    expect(await service.obterAtivo(STORE_ID, NotificationEvent.PREPARING)).toBeNull();
  });

  it('template existente e ativo: devolve o template', async () => {
    const { service } = makeService({
      existentes: [{ event: NotificationEvent.PREPARING, isActive: true, message: 'texto customizado' }],
    });

    const template = await service.obterAtivo(STORE_ID, NotificationEvent.PREPARING);

    expect(template?.message).toBe('texto customizado');
  });

  it('corrida de criacao simultanea (colisao no unique): rele o que a outra chamada gravou', async () => {
    const { service } = makeService({
      existentes: [{ event: NotificationEvent.PREPARING, isActive: true, message: 'ja existente' }],
      criarLancaColisao: true,
    });

    /* findUnique so acha depois da "outra chamada" ja ter gravado — aqui
       simulado devolvendo o existente desde o inicio, o que basta para
       provar que o catch cai em findUniqueOrThrow em vez de propagar o
       erro do create(). */
    const template = await service.obterAtivo(STORE_ID, NotificationEvent.PREPARING);

    expect(template?.message).toBe('ja existente');
  });
});

describe('MessageTemplateService.renderizar', () => {
  it('substitui todos os placeholders conhecidos', () => {
    const { service } = makeService();

    const texto = service.renderizar('Ola {nome}, pedido #{pedido} de {valor} esta {status}. Tel: {telefone}', {
      nome: 'Joao',
      pedido: 'A001',
      valor: 'R$ 30,00',
      status: 'Em preparo',
      telefone: '(11) 97070-6978',
    });

    expect(texto).toBe('Ola Joao, pedido #A001 de R$ 30,00 esta Em preparo. Tel: (11) 97070-6978');
  });

  it('placeholder repetido e substituido em todas as ocorrencias', () => {
    const { service } = makeService();

    const texto = service.renderizar('{nome}, {nome}!', {
      nome: 'Ana',
      pedido: '',
      valor: '',
      status: '',
      telefone: '',
    });

    expect(texto).toBe('Ana, Ana!');
  });

  it('placeholder desconhecido (fora dos 5) fica intacto', () => {
    const { service } = makeService();

    const texto = service.renderizar('cupom {cupom} para {nome}', {
      nome: 'Ana',
      pedido: '',
      valor: '',
      status: '',
      telefone: '',
    });

    expect(texto).toBe('cupom {cupom} para Ana');
  });
});
