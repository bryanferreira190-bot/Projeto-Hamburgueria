import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { OrderStatus, OrderType, PaymentMethod } from '@adventure/shared';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { OrderPricingService } from './order-pricing.service';
import type { StoreService } from '../store/store.service';
import type { DeliveryService } from '../delivery/delivery.service';
import type { PaymentsService } from '../payments/payments.service';
import type { CashbackService } from '../cashback/cashback.service';

/**
 * Cobre os dois pontos que a auditoria identificou como reais condicoes de
 * corrida (ver DECISOES.md): status de pedido mudando duas vezes ao mesmo
 * tempo (updateStatus) e duas requisicoes de criacao colidindo na mesma
 * chave (create/createManual). Sem estes testes, uma futura mudanca podia
 * reintroduzir os dois bugs sem que ninguem percebesse.
 */

const STORE = { id: 'store-1', minOrderCents: 0, acceptsDelivery: true, acceptsPickup: true };

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

/** Um `tx` minimo, com os metodos que updateStatus/create realmente chamam. */
function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    coupon: { update: vi.fn().mockResolvedValue({}) },
    customer: { upsert: vi.fn().mockResolvedValue({ id: 'cust-1' }) },
    ...overrides,
  };
}

/**
 * Forma completa que toOrderDto() precisa para montar a resposta — usada
 * pelo findById() que updateStatus()/create() chamam no final para devolver
 * o pedido atualizado. Os testes so se importam com um subconjunto destes
 * campos (status, couponId etc.); o resto e preenchimento generico so para
 * toOrderDto nao quebrar em `.items.map(...)` e afins.
 */
function fullOrder(overrides: Record<string, unknown>) {
  return {
    id: 'o1',
    number: 'A001',
    status: OrderStatus.CONFIRMED,
    type: OrderType.PICKUP,
    couponId: null,
    isManual: false,
    manualCustomerName: null,
    createdAt: new Date(),
    subtotalCents: 3000,
    deliveryFeeCents: 0,
    discountCents: 0,
    totalCents: 3000,
    paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
    changeForCents: null,
    notes: null,
    cancelReason: null,
    items: [],
    customer: null,
    statusHistory: [],
    payments: [],
    address: null,
    ...overrides,
  };
}

function makeService(opts: {
  tx?: ReturnType<typeof makeTx>;
  order?: Record<string, unknown> | null;
  transactionImpl?: (fn: (tx: unknown) => unknown) => unknown;
  orderFindFirst?: ReturnType<typeof vi.fn>;
}) {
  const tx = opts.tx ?? makeTx();

  const transactionMock =
    opts.transactionImpl ??
    vi.fn(async (fn: (tx: unknown) => unknown) => {
      if (typeof fn !== 'function') throw new Error('esperava callback de transacao');
      return fn(tx);
    });

  const findUniqueResult = opts.order === null ? null : fullOrder(opts.order ?? {});

  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(findUniqueResult),
      findFirst: opts.orderFindFirst ?? vi.fn().mockResolvedValue(opts.order ?? null),
    },
    store: { findFirst: vi.fn().mockResolvedValue(STORE) },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const pricing = {
    price: vi.fn().mockResolvedValue({
      items: [],
      subtotalCents: 3000,
      deliveryFeeCents: 0,
      discountCents: 0,
      totalCents: 3000,
      couponId: null,
    }),
  } as unknown as OrderPricingService;

  const store = {
    getStatus: vi.fn().mockResolvedValue({ isOpen: true, message: '' }),
  } as unknown as StoreService;

  const delivery = {
    quote: vi.fn(),
  } as unknown as DeliveryService;

  const payments = {
    refundIfPaid: vi.fn().mockResolvedValue(undefined),
    createPixForOrder: vi.fn(),
    createCardForOrder: vi.fn(),
  } as unknown as PaymentsService;

  const cashback = {
    saldoDoCliente: vi.fn().mockResolvedValue({ totalCents: 0, proximoVencimento: null }),
    calcularResgateMaximo: vi.fn().mockReturnValue(0),
    consumir: vi.fn().mockResolvedValue(0),
    creditarPorPedido: vi.fn().mockResolvedValue(undefined),
  } as unknown as CashbackService;

  const service = new OrdersService(prisma, pricing, store, delivery, payments, cashback);
  return { service, prisma, tx, payments, cashback };
}

const PEDIDO_BASE: CreateOrderFixture = {
  type: OrderType.PICKUP,
  customer: { name: 'Cliente Teste', phone: '11999998888' },
  items: [{ productId: 'p1', quantity: 1, optionIds: [] }],
  paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
  changeForCents: 5000,
};

/* Tipagem leve so para o fixture do teste — o schema real (Zod) ja e
   validado em outro lugar; aqui so precisamos de um objeto compativel. */
type CreateOrderFixture = {
  type: OrderType;
  customer: { name: string; phone: string };
  items: { productId: string; quantity: number; optionIds: string[] }[];
  paymentMethod: PaymentMethod;
  changeForCents?: number;
};

describe('OrdersService.updateStatus — compare-and-swap', () => {
  it('aplica a transicao quando ninguem mais mexeu no pedido', async () => {
    const tx = makeTx();
    const { service } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.CONFIRMED, type: OrderType.PICKUP, couponId: null },
    });

    await service.updateStatus('o1', OrderStatus.PREPARING);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', status: OrderStatus.CONFIRMED },
      data: expect.objectContaining({ status: OrderStatus.PREPARING }),
    });
    expect(tx.orderStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it('recusa com ConflictException quando outra acao ja mudou o status entre a leitura e a escrita', async () => {
    /* Simula a corrida de verdade: o updateMany nao encontra mais nenhuma
       linha com o status antigo porque outra requisicao (duplo clique,
       ou o webhook do Mercado Pago) ja escreveu por cima primeiro. */
    const tx = makeTx({ order: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn(), count: vi.fn() } });
    const { service } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.CONFIRMED, type: OrderType.PICKUP, couponId: null },
    });

    await expect(service.updateStatus('o1', OrderStatus.PREPARING)).rejects.toThrow(ConflictException);

    /* A corrida perdida nao pode deixar rastro: nem historico, nem cupom
       mexido — a transacao inteira precisa ter sido descartada. */
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
  });

  it('cancelamento com corrida perdida nao decrementa o cupom nem tenta estornar', async () => {
    const tx = makeTx({ order: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn(), count: vi.fn() } });
    const { service, payments } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.CONFIRMED, type: OrderType.PICKUP, couponId: 'cup-1' },
    });

    await expect(service.updateStatus('o1', OrderStatus.CANCELED)).rejects.toThrow(ConflictException);

    expect(tx.coupon.update).not.toHaveBeenCalled();
    expect(payments.refundIfPaid).not.toHaveBeenCalled();
  });

  it('cancelamento bem-sucedido decrementa o cupom e aciona o estorno', async () => {
    const tx = makeTx();
    const { service, payments } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.CONFIRMED, type: OrderType.PICKUP, couponId: 'cup-1' },
    });

    await service.updateStatus('o1', OrderStatus.CANCELED, { reason: 'Cliente desistiu' });

    expect(tx.coupon.update).toHaveBeenCalledWith({
      where: { id: 'cup-1' },
      data: { usageCount: { decrement: 1 } },
    });
    expect(payments.refundIfPaid).toHaveBeenCalledWith('o1', 'A001');
  });

  it('recusa transicao invalida (ex.: pedido ja entregue) sem tocar no banco', async () => {
    const tx = makeTx();
    const { service } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.DELIVERED, type: OrderType.DELIVERY, couponId: null },
    });

    await expect(service.updateStatus('o1', OrderStatus.PREPARING)).rejects.toThrow(ConflictException);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('recusa "saiu para entrega" num pedido de retirada', async () => {
    const { service } = makeService({
      order: { id: 'o1', number: 'A001', status: OrderStatus.READY, type: OrderType.PICKUP, couponId: null },
    });

    await expect(service.updateStatus('o1', OrderStatus.OUT_FOR_DELIVERY)).rejects.toThrow(ConflictException);
  });
});

describe('OrdersService.create — idempotencia e colisao concorrente', () => {
  it('devolve o pedido existente sem recalcular nada quando a idempotencyKey ja foi usada', async () => {
    const { service, prisma } = makeService({ order: { id: 'o1', number: 'A001', totalCents: 3000 } });

    const resultado = await service.create(PEDIDO_BASE as never, 'chave-123');

    expect(resultado.number).toBe('A001');
    /* Achou de cara pela idempotencyKey — nunca chegou a consultar status
       da loja nem a precificar de novo. */
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('tenta de novo quando dois pedidos colidem no mesmo numero do dia, e da certo na segunda vez', async () => {
    let tentativa = 0;
    const tx = makeTx();
    tx.order.create = vi.fn().mockImplementation(() => {
      tentativa += 1;
      if (tentativa === 1) throw p2002(['storeId', 'orderDate', 'number']);
      return { id: 'o2', number: 'A013', totalCents: 3000 };
    });

    const transactionImpl = vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx));

    const { service, prisma } = makeService({
      tx,
      order: null, // findFirst da checagem inicial de idempotencia: nao ha
      transactionImpl,
    });
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fullOrder({ id: 'o2', number: 'A013', totalCents: 3000 }),
    );

    const resultado = await service.create(PEDIDO_BASE as never, 'chave-nova');

    expect(resultado.number).toBe('A013');
    expect(transactionImpl).toHaveBeenCalledTimes(2);
  });

  it('quando a colisao e na propria idempotencyKey, devolve o pedido que a outra requisicao ja criou', async () => {
    const tx = makeTx();
    tx.order.create = vi.fn().mockImplementation(() => {
      throw p2002(['storeId', 'idempotencyKey']);
    });

    const pedidoDaOutraRequisicao = { id: 'o3', number: 'A020', totalCents: 3000 };
    /* A primeira chamada (checagem rapida no inicio de create()) nao acha
       nada — a corrida e justamente a outra requisicao ainda nao ter
       commitado. A segunda chamada, dentro do helper de retentativa, ja
       encontra o pedido que a concorrente acabou de gravar. */
    const orderFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pedidoDaOutraRequisicao);

    const transactionImpl = vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx));

    const { service, prisma } = makeService({ tx, transactionImpl, orderFindFirst });
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fullOrder(pedidoDaOutraRequisicao),
    );

    const resultado = await service.create(PEDIDO_BASE as never, 'chave-disputada');

    expect(resultado.number).toBe('A020');
    /* So tentou UMA vez a transacao — colisao de idempotencyKey nao deve
       gerar retentativa, so localizar e devolver o que ja existe. */
    expect(transactionImpl).toHaveBeenCalledTimes(1);
  });

  it('recusa pedido quando a loja esta fechada, sem tentar criar nada', async () => {
    const { service, prisma } = makeService({ order: null });
    (prisma as unknown as { store: { findFirst: ReturnType<typeof vi.fn> } }).store.findFirst = vi
      .fn()
      .mockResolvedValue(STORE);

    const storeOverride = {
      getStatus: vi.fn().mockResolvedValue({ isOpen: false, message: 'Fechado agora' }),
    };
    Object.assign(service as unknown as { store: unknown }, { store: storeOverride });

    await expect(service.create(PEDIDO_BASE as never)).rejects.toThrow('Fechado agora');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
