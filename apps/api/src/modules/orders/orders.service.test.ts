import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { NotificationEvent, OrderStatus, OrderType, PaymentMethod } from '@adventure/shared';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';
import type { PricedItem } from './order-pricing.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { OrderPricingService } from './order-pricing.service';
import type { StoreService } from '../store/store.service';
import type { DeliveryService } from '../delivery/delivery.service';
import type { PaymentsService } from '../payments/payments.service';
import type { CashbackService } from '../cashback/cashback.service';
import type { MessagingService } from '../notifications/messaging.service';

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
    storeId: STORE.id,
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

/** Item precificado minimo, so com o que o teste de {itens} precisa conferir. */
function criarItemPrecificado(productName: string): PricedItem {
  return {
    productId: 'p1',
    productName,
    quantity: 1,
    unitPriceCents: 1500,
    optionsPriceCents: 0,
    totalCents: 1500,
    options: [],
  };
}

function makeService(opts: {
  tx?: ReturnType<typeof makeTx>;
  order?: Record<string, unknown> | null;
  transactionImpl?: (fn: (tx: unknown) => unknown) => unknown;
  orderFindFirst?: ReturnType<typeof vi.fn>;
  pricedItems?: PricedItem[];
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
      items: opts.pricedItems ?? [],
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
    anularCreditoDoPedido: vi.fn().mockResolvedValue(undefined),
  } as unknown as CashbackService;

  /* notificar() e fire-and-forget (nunca await'ado por quem chama) e
     resolve para um objeto, nunca lanca — mock so precisa devolver algo
     "thenable" para o .catch() encadeado por OrdersService nao quebrar. */
  const messaging = {
    notificar: vi.fn().mockResolvedValue({ enviado: true, simulado: true }),
  } as unknown as MessagingService;

  const service = new OrdersService(prisma, pricing, store, delivery, payments, cashback, messaging);
  return { service, prisma, tx, payments, cashback, messaging };
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

  it('entrar em preparo credita o cashback do pedido', async () => {
    const tx = makeTx();
    const { service, cashback } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.CONFIRMED, type: OrderType.PICKUP, couponId: null },
    });

    await service.updateStatus('o1', OrderStatus.PREPARING);

    /* Cedo de proposito: o cliente ve o saldo crescer assim que a cozinha
       comeca, nao so depois de entregue. Ver DECISOES.md. */
    expect(cashback.creditarPorPedido).toHaveBeenCalledWith('o1');
  });

  it('entregar/concluir NAO credita cashback de novo — ja foi creditado ao entrar em preparo', async () => {
    const tx = makeTx();
    const { service, cashback } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.OUT_FOR_DELIVERY, type: OrderType.DELIVERY, couponId: null },
    });

    await service.updateStatus('o1', OrderStatus.DELIVERED);

    expect(cashback.creditarPorPedido).not.toHaveBeenCalled();
  });

  it('cancelamento anula o que sobrou do cashback ja creditado, na mesma transacao', async () => {
    const tx = makeTx();
    const { service, cashback } = makeService({
      tx,
      order: { id: 'o1', number: 'A001', status: OrderStatus.PREPARING, type: OrderType.PICKUP, couponId: null },
    });

    await service.updateStatus('o1', OrderStatus.CANCELED, { reason: 'Cliente desistiu' });

    expect(cashback.anularCreditoDoPedido).toHaveBeenCalledWith(tx, 'o1');
  });

  it.each([
    [OrderStatus.CONFIRMED, OrderStatus.PREPARING, NotificationEvent.PREPARING],
    [OrderStatus.PREPARING, OrderStatus.READY, NotificationEvent.READY],
    [OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY, NotificationEvent.OUT_FOR_DELIVERY],
  ])('transicao de %s para %s dispara o evento de notificacao %s', async (statusAtual, proximoStatus, evento) => {
    const { service, messaging } = makeService({
      order: { id: 'o1', number: 'A001', status: statusAtual, type: OrderType.DELIVERY, couponId: null },
    });

    await service.updateStatus('o1', proximoStatus);

    expect(messaging.notificar).toHaveBeenCalledWith(evento, expect.objectContaining({ orderId: 'o1' }));
  });

  it.each([
    [OrderStatus.DELIVERED, OrderType.DELIVERY, OrderStatus.OUT_FOR_DELIVERY],
    [OrderStatus.COMPLETED, OrderType.PICKUP, OrderStatus.AWAITING_PICKUP],
  ])(
    'transicao para %s (tipo %s) dispara o MESMO evento DELIVERED',
    async (proximoStatus, tipo, statusAtual) => {
      const { service, messaging } = makeService({
        order: { id: 'o1', number: 'A001', status: statusAtual, type: tipo, couponId: null },
      });

      await service.updateStatus('o1', proximoStatus);

      expect(messaging.notificar).toHaveBeenCalledWith(
        NotificationEvent.DELIVERED,
        expect.objectContaining({ orderId: 'o1' }),
      );
    },
  );

  it('AWAITING_PICKUP nao dispara notificacao propria — READY ja avisou', async () => {
    const { service, messaging } = makeService({
      order: { id: 'o1', number: 'A001', status: OrderStatus.READY, type: OrderType.PICKUP, couponId: null },
    });

    await service.updateStatus('o1', OrderStatus.AWAITING_PICKUP);

    expect(messaging.notificar).not.toHaveBeenCalled();
  });

  it('entrar em preparo notifica PREPARING com os itens do pedido', async () => {
    /* items completo o bastante para nao quebrar toOrderDto() tambem —
       findById() (chamado no final de updateStatus) reusa o mesmo mock
       de prisma.order.findUnique. */
    const itemDoPedido = (productName: string) => ({
      productName,
      quantity: 1,
      unitPriceCents: 1500,
      totalCents: 1500,
      notes: null,
      options: [],
    });

    const { service, messaging } = makeService({
      order: {
        id: 'o1',
        number: 'A001',
        status: OrderStatus.CONFIRMED,
        type: OrderType.PICKUP,
        couponId: null,
        items: [
          itemDoPedido('Bacon Burguer'),
          itemDoPedido('Classic Burguer'),
          itemDoPedido('Refrigerante'),
        ],
      },
    });

    await service.updateStatus('o1', OrderStatus.PREPARING);

    const [evento, contexto] = (messaging.notificar as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(evento).toBe(NotificationEvent.PREPARING);
    expect(
      (contexto.items as { productName: string; quantity: number }[]).map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
      })),
    ).toEqual([
      { productName: 'Bacon Burguer', quantity: 1 },
      { productName: 'Classic Burguer', quantity: 1 },
      { productName: 'Refrigerante', quantity: 1 },
    ]);
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

  it('pedido confirmado na hora (pagamento offline) notifica ORDER_RECEIVED com os itens precificados', async () => {
    const tx = makeTx();
    tx.order.create = vi.fn().mockResolvedValue({
      id: 'o4',
      number: 'A030',
      totalCents: 3000,
      status: OrderStatus.CONFIRMED,
      storeId: STORE.id,
    });
    const transactionImpl = vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx));

    const { service, prisma, messaging } = makeService({
      tx,
      order: null,
      transactionImpl,
      pricedItems: [
        criarItemPrecificado('Bacon Burguer'),
        criarItemPrecificado('Classic Burguer'),
        criarItemPrecificado('Refrigerante'),
      ],
    });
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fullOrder({ id: 'o4', number: 'A030', totalCents: 3000, status: OrderStatus.CONFIRMED }),
    );

    await service.create(PEDIDO_BASE as never, 'chave-itens');

    expect(messaging.notificar).toHaveBeenCalledWith(
      NotificationEvent.ORDER_RECEIVED,
      expect.objectContaining({
        items: [
          { productName: 'Bacon Burguer', quantity: 1 },
          { productName: 'Classic Burguer', quantity: 1 },
          { productName: 'Refrigerante', quantity: 1 },
        ],
      }),
    );
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

describe('OrdersService.list', () => {
  /**
   * O painel administrativo sondando isto a cada 15s e a consulta mais
   * repetida do sistema — statusHistory e payments nunca sao lidos pelo
   * painel (so pela tela de acompanhamento do cliente, que usa
   * findById/findByNumber, nao list). Buscar os dois aqui seria trabalho
   * jogado fora a cada pedido, a cada 15 segundos. Ver DECISOES.md.
   */
  function makeListService(pedidos: Record<string, unknown>[]) {
    const prisma = {
      order: { findMany: vi.fn().mockResolvedValue(pedidos.map((p) => fullOrder(p))) },
    } as unknown as PrismaService;

    const service = new OrdersService(
      prisma,
      {} as OrderPricingService,
      {} as StoreService,
      {} as DeliveryService,
      {} as PaymentsService,
      {} as CashbackService,
      {} as MessagingService,
    );

    return { service, prisma };
  }

  it('nao pede statusHistory nem payments ao banco', async () => {
    const { service, prisma } = makeListService([]);

    await service.list({ limit: 20 });

    const consulta = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(consulta.include).not.toHaveProperty('statusHistory');
    expect(consulta.include).not.toHaveProperty('payments');
  });

  it('mesmo sem buscar do banco, devolve timeline vazia e payment nulo — nunca undefined', async () => {
    const { service } = makeListService([{ id: 'o1', number: 'A001' }]);

    const resultado = await service.list({ limit: 20 });

    expect(resultado.orders[0]).toMatchObject({ timeline: [], payment: null });
  });
});

describe('OrdersService.buscarClientePorTelefone', () => {
  /**
   * O balcao consulta isto ANTES de lancar o pedido. Cadastro e por
   * telefone (mesma chave que customer.upsert usa em create/createManual)
   * — sem avisar quem esta atendendo, digitar um numero que ja pertence
   * a outra pessoa sobrescreve o nome dela em silencio. Foi exatamente
   * isso que aconteceu em producao (ver DECISOES.md).
   */
  function makeLookupService(store: { id: string } | null, customer: { name: string | null } | null) {
    const prisma = {
      store: { findFirst: vi.fn().mockResolvedValue(store) },
      customer: { findUnique: vi.fn().mockResolvedValue(customer) },
    } as unknown as PrismaService;

    const service = new OrdersService(
      prisma,
      {} as OrderPricingService,
      {} as StoreService,
      {} as DeliveryService,
      {} as PaymentsService,
      {} as CashbackService,
      {} as MessagingService,
    );

    return { service, prisma };
  }

  it('telefone sem cadastro devolve null', async () => {
    const { service } = makeLookupService(STORE, null);

    expect(await service.buscarClientePorTelefone('11999998888')).toBeNull();
  });

  it('telefone ja cadastrado devolve o nome atual', async () => {
    const { service } = makeLookupService(STORE, { name: 'Vanessa' });

    expect(await service.buscarClientePorTelefone('11999998888')).toEqual({ name: 'Vanessa' });
  });

  it('cliente cadastrado so com telefone (sem nome) devolve name: null, nao "sem cadastro"', async () => {
    /* Distincao importa: null no NIVEL DE FORA (a funcao inteira) e
       "ninguem tem esse numero"; { name: null } e "alguem tem, mas nao
       deixou nome" — confundir os dois faria o balcao achar que o
       numero esta livre quando na verdade ja e de alguem. */
    const { service } = makeLookupService(STORE, { name: null });

    expect(await service.buscarClientePorTelefone('11999998888')).toEqual({ name: null });
  });

  it('sem loja configurada, nao explode — devolve null', async () => {
    const { service } = makeLookupService(null, null);

    expect(await service.buscarClientePorTelefone('11999998888')).toBeNull();
  });
});
