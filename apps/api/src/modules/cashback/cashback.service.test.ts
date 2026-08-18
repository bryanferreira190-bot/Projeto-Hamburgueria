import { describe, expect, it, vi } from 'vitest';
import { CashbackService } from './cashback.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { Prisma } from '@prisma/client';

/**
 * Cashback mexe direto na margem da loja e no bolso do cliente. Um erro
 * de arredondamento aqui vira dinheiro dado de graca ou cliente
 * reclamando de saldo que sumiu — dai a cobertura detalhada.
 */

function makeService(creditos: unknown[] = []) {
  const prisma = {
    cashbackCredit: {
      findMany: vi.fn().mockResolvedValue(creditos),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customer: { findUnique: vi.fn().mockResolvedValue({ id: 'cust-1' }) },
    order: { findUnique: vi.fn() },
  } as unknown as PrismaService;

  return { service: new CashbackService(prisma), prisma };
}

const daquiA = (dias: number) => {
  const data = new Date();
  data.setDate(data.getDate() + dias);
  return data;
};

describe('CashbackService.saldoDoCliente', () => {
  it('soma os creditos ainda validos', async () => {
    const { service } = makeService([
      { remainingCents: 500, expiresAt: daquiA(5) },
      { remainingCents: 320, expiresAt: daquiA(12) },
    ]);

    const saldo = await service.saldoDoCliente('cust-1');

    expect(saldo.totalCents).toBe(820);
  });

  it('aponta o credito que vence primeiro — e o que o aviso usa', async () => {
    const vencePrimeiro = daquiA(2);
    const { service } = makeService([
      { remainingCents: 500, expiresAt: vencePrimeiro },
      { remainingCents: 900, expiresAt: daquiA(15) },
    ]);

    const saldo = await service.saldoDoCliente('cust-1');

    expect(saldo.proximoVencimento).toEqual({ amountCents: 500, expiresAt: vencePrimeiro });
  });

  it('sem credito nenhum, saldo zero e sem vencimento', async () => {
    const { service } = makeService([]);

    const saldo = await service.saldoDoCliente('cust-1');

    expect(saldo.totalCents).toBe(0);
    expect(saldo.proximoVencimento).toBeNull();
  });

  it('a consulta filtra por validade e por saldo restante', async () => {
    const { service, prisma } = makeService([]);

    await service.saldoDoCliente('cust-1');

    const where = (prisma.cashbackCredit.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .where;
    /* Credito vencido nunca pode entrar no saldo, mesmo que o job diario
       ainda nao tenha carimbado ele como expirado. */
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
    expect(where.remainingCents).toEqual({ gt: 0 });
  });
});

describe('CashbackService.calcularResgateMaximo', () => {
  it('limita ao teto percentual da loja', () => {
    const { service } = makeService();
    /* Pedido de R$ 100, saldo de R$ 80, teto de 50% -> so R$ 50. */
    expect(service.calcularResgateMaximo(10_000, 8_000, 50)).toBe(5_000);
  });

  it('limita ao saldo quando o saldo e menor que o teto', () => {
    const { service } = makeService();
    /* Pedido de R$ 100, teto de 50% (R$ 50), mas so tem R$ 12 de saldo. */
    expect(service.calcularResgateMaximo(10_000, 1_200, 50)).toBe(1_200);
  });

  it('teto de 100% deixa usar o saldo inteiro', () => {
    const { service } = makeService();
    expect(service.calcularResgateMaximo(10_000, 8_000, 100)).toBe(8_000);
  });

  it('nunca devolve valor negativo', () => {
    const { service } = makeService();
    expect(service.calcularResgateMaximo(0, 5_000, 50)).toBe(0);
  });
});

describe('CashbackService.consumir', () => {
  function makeTx(creditos: { id: string; remainingCents: number }[]) {
    return {
      cashbackCredit: {
        findMany: vi.fn().mockResolvedValue(creditos),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as Prisma.TransactionClient;
  }

  it('consome primeiro o credito que vence antes (FIFO)', async () => {
    const { service } = makeService();
    /* findMany ja devolve ordenado por expiresAt asc — o service confia
       nessa ordem, entao o primeiro da lista e o que vence primeiro. */
    const tx = makeTx([
      { id: 'vence-antes', remainingCents: 300 },
      { id: 'vence-depois', remainingCents: 900 },
    ]);

    const usado = await service.consumir(tx, 'cust-1', 500);

    expect(usado).toBe(500);

    const chamadas = (tx.cashbackCredit.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(chamadas[0]![0].where.id).toBe('vence-antes');
    /* Zerou o primeiro (300) e tirou os 200 restantes do segundo. */
    expect(chamadas[0]![0].data.remainingCents).toBe(0);
    expect(chamadas[1]![0].where.id).toBe('vence-depois');
    expect(chamadas[1]![0].data.remainingCents).toBe(700);
  });

  it('nunca consome mais do que o saldo existente', async () => {
    const { service } = makeService();
    const tx = makeTx([{ id: 'c1', remainingCents: 200 }]);

    /* Pediu 999 mas so havia 200 — devolve o que realmente deu. */
    const usado = await service.consumir(tx, 'cust-1', 999);

    expect(usado).toBe(200);
  });

  it('valor zero ou negativo nao toca no banco', async () => {
    const { service } = makeService();
    const tx = makeTx([{ id: 'c1', remainingCents: 500 }]);

    expect(await service.consumir(tx, 'cust-1', 0)).toBe(0);
    expect(tx.cashbackCredit.findMany).not.toHaveBeenCalled();
  });

  it('credito consumido por outro pedido em paralelo nao vira saldo negativo', async () => {
    const { service } = makeService();
    const tx = makeTx([{ id: 'c1', remainingCents: 300 }]);

    /* count 0 = o WHERE com o remainingCents esperado nao achou a linha,
       porque outro pedido consumiu esse credito no meio do caminho. */
    (tx.cashbackCredit.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const usado = await service.consumir(tx, 'cust-1', 300);

    /* Nao contabiliza o que nao conseguiu debitar. */
    expect(usado).toBe(0);
  });
});

describe('CashbackService.creditarPorPedido', () => {
  function makeServiceComPedido(order: unknown) {
    /* createMany + skipDuplicates: o "ja existia" nao vira excecao, so
       devolve count 0 — ver o comentario no service. */
    const create = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      cashbackCredit: { createMany: create },
    } as unknown as PrismaService;

    return { service: new CashbackService(prisma), create };
  }

  /** O service manda `data` como array de um item so. */
  const dadosDoCredito = (create: ReturnType<typeof vi.fn>) => create.mock.calls[0]![0].data[0];

  const PEDIDO = {
    id: 'o1',
    number: 'A001',
    storeId: 'store-1',
    customerId: 'cust-1',
    subtotalCents: 10_000,
    discountCents: 0,
    cashbackUsedCents: 0,
    store: { cashbackPercent: 5, cashbackExpiryDays: 20 },
  };

  it('credita 5% do valor pago', async () => {
    const { service, create } = makeServiceComPedido(PEDIDO);

    await service.creditarPorPedido('o1');

    expect(dadosDoCredito(create)).toMatchObject({ amountCents: 500, remainingCents: 500 });
  });

  it('desconta cupom e cashback usado da base — cashback nao gera cashback', async () => {
    const { service, create } = makeServiceComPedido({
      ...PEDIDO,
      discountCents: 2_000,
      cashbackUsedCents: 3_000,
    });

    await service.creditarPorPedido('o1');

    /* Base = 10000 - 2000 - 3000 = 5000; 5% = 250. Se o cashback usado
       entrasse na base, o saldo se realimentaria sozinho. */
    expect(dadosDoCredito(create)).toMatchObject({ amountCents: 250 });
  });

  it('pedido de balcao sem cliente nao gera credito', async () => {
    const { service, create } = makeServiceComPedido({ ...PEDIDO, customerId: null });

    await service.creditarPorPedido('o1');

    expect(create).not.toHaveBeenCalled();
  });

  it('percentual zero desliga o programa', async () => {
    const { service, create } = makeServiceComPedido({
      ...PEDIDO,
      store: { cashbackPercent: 0, cashbackExpiryDays: 20 },
    });

    await service.creditarPorPedido('o1');

    expect(create).not.toHaveBeenCalled();
  });

  it('valor que arredonda para zero nao vira credito de R$ 0,00', async () => {
    const { service, create } = makeServiceComPedido({ ...PEDIDO, subtotalCents: 10 });

    await service.creditarPorPedido('o1');

    /* 5% de R$ 0,10 = 0 centavos. */
    expect(create).not.toHaveBeenCalled();
  });

  it('credito em dobro no mesmo pedido nao duplica nem lanca erro', async () => {
    const { service, create } = makeServiceComPedido(PEDIDO);
    /* count 0 = a constraint @@unique([orderId]) barrou a segunda
       gravacao. E o esperado, nao um erro que deva subir. */
    create.mockResolvedValue({ count: 0 });

    await expect(service.creditarPorPedido('o1')).resolves.toBeUndefined();
  });

  it('usa skipDuplicates — a constraint e quem impede o credito em dobro', async () => {
    const { service, create } = makeServiceComPedido(PEDIDO);

    await service.creditarPorPedido('o1');

    expect(create.mock.calls[0]![0].skipDuplicates).toBe(true);
  });

  it('a validade sai da configuracao da loja, nao de constante no codigo', async () => {
    const { service, create } = makeServiceComPedido({
      ...PEDIDO,
      store: { cashbackPercent: 5, cashbackExpiryDays: 20 },
    });

    const antes = Date.now();
    await service.creditarPorPedido('o1');

    const { expiresAt } = dadosDoCredito(create);
    const diasDeDiferenca = Math.round((expiresAt.getTime() - antes) / 86_400_000);
    expect(diasDeDiferenca).toBe(20);
  });
});

describe('CashbackService.anularCreditoDoPedido', () => {
  function makeTx(credito: { id: string; remainingCents: number } | null) {
    return {
      cashbackCredit: {
        findUnique: vi.fn().mockResolvedValue(credito),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;
  }

  it('zera o que sobrou de um credito nao gasto', async () => {
    const { service } = makeService();
    const tx = makeTx({ id: 'cred-1', remainingCents: 500 });

    await service.anularCreditoDoPedido(tx, 'o1');

    expect(tx.cashbackCredit.update).toHaveBeenCalledWith({
      where: { id: 'cred-1' },
      data: { remainingCents: 0, expiredAt: expect.any(Date) },
    });
  });

  it('pedido sem credito nenhum (cancelado antes de PREPARING) nao toca no banco', async () => {
    const { service } = makeService();
    const tx = makeTx(null);

    await service.anularCreditoDoPedido(tx, 'o1');

    expect(tx.cashbackCredit.update).not.toHaveBeenCalled();
  });

  it('credito ja totalmente gasto nao toca no banco de novo', async () => {
    const { service } = makeService();
    /* Ja foi usado em outro pedido antes deste ser cancelado — nao ha
       "o que sobrou" para anular, e reescrever a mesma linha a toa. */
    const tx = makeTx({ id: 'cred-1', remainingCents: 0 });

    await service.anularCreditoDoPedido(tx, 'o1');

    expect(tx.cashbackCredit.update).not.toHaveBeenCalled();
  });

  it('anula so o que sobrou — nao mexe no que ja foi gasto em outro pedido', async () => {
    const { service } = makeService();
    /* Credito de 500 dos quais 350 ja foram gastos: so os 150 restantes
       somem, os 350 ja gastos ficam como perda aceita (ver o comentario
       do metodo). */
    const tx = makeTx({ id: 'cred-1', remainingCents: 150 });

    await service.anularCreditoDoPedido(tx, 'o1');

    expect(tx.cashbackCredit.update).toHaveBeenCalledWith({
      where: { id: 'cred-1' },
      data: { remainingCents: 0, expiredAt: expect.any(Date) },
    });
  });
});
