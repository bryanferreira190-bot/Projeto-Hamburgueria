import { OrderStatus, PaymentStatus } from '@adventure/shared';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { MercadoPagoService } from './mercadopago.service';
import type { Env } from '../../config/env';

/**
 * O ponto central que a auditoria pediu para verificar: o sistema NUNCA
 * pode considerar um pagamento aprovado so porque o corpo do webhook disse
 * isso. handleNotification() so usa o corpo para saber QUAL pedido mudou —
 * o status em si sempre vem de uma consulta de volta na API do Mercado
 * Pago (getOrder). Estes testes provam isso, e cobrem os dois cenarios de
 * inconsistencia que a auditoria pediu para checar: webhook repetido, e
 * webhook para um pagamento que nao existe no nosso banco.
 */

const ENV = {} as Env;

function makeService(opts: {
  payment?: { id: string; orderId: string; status: PaymentStatus } | null;
  order?: { id: string; number: string; status: OrderStatus } | null;
  mpOrderStatus?: string;
  mpOrderStatusDetail?: string | null;
}) {
  const paymentUpdate = vi.fn().mockResolvedValue({});
  const orderTx = {
    update: vi.fn().mockResolvedValue({}),
  };
  const historyTx = { create: vi.fn().mockResolvedValue({}) };

  const tx = {
    order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
  };

  const prisma = {
    payment: {
      findUnique: vi.fn().mockResolvedValue(opts.payment ?? null),
      update: paymentUpdate,
      findFirst: vi.fn(),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(opts.order ?? null),
      update: orderTx.update,
    },
    orderStatusHistory: historyTx,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const mercadoPago = {
    getOrder: vi.fn().mockResolvedValue({
      id: 'mp-order-1',
      status: opts.mpOrderStatus ?? 'processed',
      status_detail: opts.mpOrderStatusDetail ?? null,
    }),
    refundOrder: vi.fn().mockResolvedValue({}),
  } as unknown as MercadoPagoService;

  const service = new PaymentsService(prisma, mercadoPago, ENV);
  return { service, prisma, mercadoPago, tx };
}

describe('PaymentsService.handleNotification — nunca confia no corpo do webhook', () => {
  it('ignora tipos de evento que nao sao "order" (ex.: merchant_order)', async () => {
    const { service, mercadoPago } = makeService({});

    await service.handleNotification('merchant_order', 'algum-id');

    /* Nem chega a perguntar pro Mercado Pago o status — o tipo de evento
       ja descarta antes disso. */
    expect(mercadoPago.getOrder).not.toHaveBeenCalled();
  });

  it('sem dataId, nao ha o que consultar', async () => {
    const { service, mercadoPago } = makeService({});

    await service.handleNotification('order', undefined);

    expect(mercadoPago.getOrder).not.toHaveBeenCalled();
  });

  it('busca o status SEMPRE na API do Mercado Pago, nunca aceita um status vindo de fora', async () => {
    const { service, mercadoPago } = makeService({
      payment: { id: 'pay-1', orderId: 'o1', status: PaymentStatus.PENDING },
      order: { id: 'o1', number: 'A001', status: OrderStatus.PENDING_PAYMENT },
      mpOrderStatus: 'processed',
    });

    await service.handleNotification('order', 'mp-order-1');

    /* A UNICA fonte do status usado e a resposta de getOrder(dataId) — o
       webhook em si (tipo, corpo) nunca carrega um "aprovado: true" que a
       funcao aceite direto. */
    expect(mercadoPago.getOrder).toHaveBeenCalledWith('mp-order-1');
  });

  it('webhook para um pagamento que nao existe no banco nao derruba a API (so ignora)', async () => {
    const { service, prisma } = makeService({ payment: null });

    await expect(service.handleNotification('order', 'mp-order-1')).resolves.toBeUndefined();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('notificacao repetida com o MESMO status resultante nao mexe em nada (idempotente)', async () => {
    const { service, prisma } = makeService({
      payment: { id: 'pay-1', orderId: 'o1', status: PaymentStatus.PAID },
      mpOrderStatus: 'processed', // mapeia para PAID -- igual ao que ja esta gravado
    });

    await service.handleNotification('order', 'mp-order-1');

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it('pagamento aprovado avanca o pedido de PENDING_PAYMENT para CONFIRMED', async () => {
    const { service, prisma, tx } = makeService({
      payment: { id: 'pay-1', orderId: 'o1', status: PaymentStatus.PENDING },
      order: { id: 'o1', number: 'A001', status: OrderStatus.PENDING_PAYMENT },
      mpOrderStatus: 'processed',
    });

    await service.handleNotification('order', 'mp-order-1');

    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-1' },
        data: expect.objectContaining({ status: PaymentStatus.PAID }),
      }),
    );
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1', status: OrderStatus.PENDING_PAYMENT },
      }),
    );
  });

  it('nao mexe no pedido se ele ja saiu de PENDING_PAYMENT por outro caminho (ex.: admin confirmou na mao)', async () => {
    const { service, tx } = makeService({
      payment: { id: 'pay-1', orderId: 'o1', status: PaymentStatus.PENDING },
      order: { id: 'o1', number: 'A001', status: OrderStatus.PREPARING }, // ja avancou
      mpOrderStatus: 'processed',
    });

    await service.handleNotification('order', 'mp-order-1');

    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.refundIfPaid', () => {
  it('nao faz nada quando o pedido nao tem pagamento aprovado (ex.: pago na entrega)', async () => {
    const prisma = {
      payment: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const mercadoPago = { refundOrder: vi.fn() } as unknown as MercadoPagoService;
    const service = new PaymentsService(prisma, mercadoPago, ENV);

    await service.refundIfPaid('o1', 'A001');

    expect(mercadoPago.refundOrder).not.toHaveBeenCalled();
  });

  it('estorna e marca REFUNDED quando havia um pagamento aprovado', async () => {
    const paymentUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      payment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'pay-1',
          externalId: 'mp-order-1',
          amountCents: 4500,
          status: PaymentStatus.PAID,
        }),
        update: paymentUpdate,
      },
    } as unknown as PrismaService;
    const mercadoPago = {
      refundOrder: vi.fn().mockResolvedValue({}),
    } as unknown as MercadoPagoService;
    const service = new PaymentsService(prisma, mercadoPago, ENV);

    await service.refundIfPaid('o1', 'A001');

    expect(mercadoPago.refundOrder).toHaveBeenCalledWith('mp-order-1');
    expect(paymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-1' },
        data: expect.objectContaining({ status: PaymentStatus.REFUNDED }),
      }),
    );
  });

  it('falha no estorno nao lanca excecao (fica so registrado para conciliacao manual)', async () => {
    const prisma = {
      payment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'pay-1',
          externalId: 'mp-order-1',
          amountCents: 4500,
          status: PaymentStatus.PAID,
        }),
        update: vi.fn(),
      },
    } as unknown as PrismaService;
    const mercadoPago = {
      refundOrder: vi.fn().mockRejectedValue(new Error('Mercado Pago fora do ar')),
    } as unknown as MercadoPagoService;
    const service = new PaymentsService(prisma, mercadoPago, ENV);

    await expect(service.refundIfPaid('o1', 'A001')).resolves.toBeUndefined();
    expect((prisma.payment.update as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
