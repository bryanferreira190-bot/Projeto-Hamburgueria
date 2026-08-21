import { NotificationEvent, OrderStatus } from '@adventure/shared';
import { describe, expect, it, vi } from 'vitest';
import { CashbackReminderJob } from './cashback-reminder.job';
import type { MessagingService } from './messaging.service';
import type { CashbackService } from '../cashback/cashback.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * A regra mais sensivel deste job: consulta o saldo NA HORA do envio
 * (nunca um valor guardado do momento da compra), nunca manda pra quem
 * esta com saldo zero, e nunca manda duas vezes pro mesmo pedido — os
 * testes abaixo cobrem exatamente essas tres garantias, mais o que
 * acontece quando a Evolution falha ou o job roda de novo no mesmo dia.
 */

const PEDIDO_BASE = {
  id: 'order-1',
  number: 'A001',
  storeId: 'store-1',
  totalCents: 3000,
  status: OrderStatus.DELIVERED,
  customerId: 'customer-1',
  customer: { name: 'Joao da Silva', phone: '11970706978' },
};

function makeJob(opts: {
  pedidos?: (typeof PEDIDO_BASE)[];
  jaAvisados?: string[];
  saldoCents?: number;
  saldoPorPedido?: Record<string, number>;
  saldoFalha?: boolean;
  notificarResultado?: { enviado: boolean; simulado: boolean; motivo?: string };
} = {}) {
  const pedidos = opts.pedidos ?? [PEDIDO_BASE];

  const prisma = {
    order: { findMany: vi.fn().mockResolvedValue(pedidos) },
    notificationLog: {
      findMany: vi
        .fn()
        .mockResolvedValue((opts.jaAvisados ?? []).map((orderId) => ({ orderId }))),
    },
  } as unknown as PrismaService;

  const cashback = {
    saldoDoCliente: vi.fn((customerId: string) => {
      if (opts.saldoFalha) return Promise.reject(new Error('DB fora do ar'));
      const totalCents = opts.saldoPorPedido?.[customerId] ?? opts.saldoCents ?? 0;
      return Promise.resolve({ totalCents, proximoVencimento: null });
    }),
  } as unknown as CashbackService;

  const messaging = {
    notificar: vi
      .fn()
      .mockResolvedValue(opts.notificarResultado ?? { enviado: true, simulado: false }),
  } as unknown as MessagingService;

  return { job: new CashbackReminderJob(prisma, cashback, messaging), prisma, cashback, messaging };
}

describe('CashbackReminderJob.avisarPedidosDeOntem', () => {
  it('sem pedido de ontem, nao consulta saldo nem manda nada', async () => {
    const { job, cashback, messaging } = makeJob({ pedidos: [] });

    const resultado = await job.avisarPedidosDeOntem();

    expect(resultado).toEqual({ elegiveis: 0, enviados: 0, semSaldo: 0 });
    expect(cashback.saldoDoCliente).not.toHaveBeenCalled();
    expect(messaging.notificar).not.toHaveBeenCalled();
  });

  it('consulta pedidos criados ONTEM (nao hoje, nao anteontem) e exclui cancelados/sem cliente', async () => {
    const { job, prisma } = makeJob({ pedidos: [] });

    await job.avisarPedidosDeOntem();

    const consulta = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const inicio = consulta.where.createdAt.gte as Date;
    const fim = consulta.where.createdAt.lt as Date;
    expect(fim.getTime() - inicio.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(consulta.where.status).toEqual({ not: OrderStatus.CANCELED });
    expect(consulta.where.customerId).toEqual({ not: null });
  });

  it('cliente COM cashback: consulta o saldo na hora do envio e manda pelo MessagingService', async () => {
    const { job, cashback, messaging } = makeJob({ saldoCents: 1250 });

    const resultado = await job.avisarPedidosDeOntem();

    expect(cashback.saldoDoCliente).toHaveBeenCalledWith('customer-1');
    expect(messaging.notificar).toHaveBeenCalledWith(
      NotificationEvent.CASHBACK_REMINDER,
      expect.objectContaining({
        orderId: 'order-1',
        storeId: 'store-1',
        phone: '11970706978',
        customerName: 'Joao da Silva',
      }),
    );
    expect(resultado).toEqual({ elegiveis: 1, enviados: 1, semSaldo: 0 });
  });

  it('cliente com cashback ZERO: nao chama o MessagingService, nao conta como enviado', async () => {
    const { job, messaging } = makeJob({ saldoCents: 0 });

    const resultado = await job.avisarPedidosDeOntem();

    expect(messaging.notificar).not.toHaveBeenCalled();
    expect(resultado).toEqual({ elegiveis: 1, enviados: 0, semSaldo: 1 });
  });

  it('pedido cujo evento CASHBACK_REMINDER ja foi enviado com sucesso: pula sem consultar saldo de novo', async () => {
    const { job, cashback, messaging } = makeJob({ jaAvisados: ['order-1'] });

    const resultado = await job.avisarPedidosDeOntem();

    expect(cashback.saldoDoCliente).not.toHaveBeenCalled();
    expect(messaging.notificar).not.toHaveBeenCalled();
    expect(resultado).toEqual({ elegiveis: 0, enviados: 0, semSaldo: 0 });
  });

  it('execucao duplicada no mesmo dia (job rodou duas vezes): a segunda nao manda de novo', async () => {
    /* Simula a idempotencia de fora: na primeira chamada nada foi
       avisado ainda; na segunda, o NotificationLog ja tem o registro de
       sucesso — exatamente o que MessagingService.enviar() gravaria. */
    const primeira = makeJob({ saldoCents: 1250 });
    await primeira.job.avisarPedidosDeOntem();
    expect(primeira.messaging.notificar).toHaveBeenCalledTimes(1);

    const segunda = makeJob({ saldoCents: 1250, jaAvisados: ['order-1'] });
    const resultado = await segunda.job.avisarPedidosDeOntem();

    expect(segunda.messaging.notificar).not.toHaveBeenCalled();
    expect(resultado.enviados).toBe(0);
  });

  it('Evolution indisponivel (MessagingService devolve enviado:false): nao conta como enviado, nao lanca', async () => {
    const { job } = makeJob({
      saldoCents: 1250,
      notificarResultado: { enviado: false, simulado: false, motivo: 'HTTP 500' },
    });

    const resultado = await job.avisarPedidosDeOntem();

    expect(resultado).toEqual({ elegiveis: 1, enviados: 0, semSaldo: 0 });
  });

  it('falha ao consultar saldo de um pedido nao derruba o lote inteiro', async () => {
    const pedidos = [
      PEDIDO_BASE,
      { ...PEDIDO_BASE, id: 'order-2', number: 'A002', customerId: 'customer-2' },
    ];
    const prisma = {
      order: { findMany: vi.fn().mockResolvedValue(pedidos) },
      notificationLog: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    /* Falha so na primeira chamada (pedido 1); a segunda (pedido 2) funciona. */
    const cashback = {
      saldoDoCliente: vi
        .fn()
        .mockRejectedValueOnce(new Error('DB fora do ar'))
        .mockResolvedValueOnce({ totalCents: 1250, proximoVencimento: null }),
    } as unknown as CashbackService;
    const messaging = {
      notificar: vi.fn().mockResolvedValue({ enviado: true, simulado: false }),
    } as unknown as MessagingService;

    const job = new CashbackReminderJob(prisma, cashback, messaging);
    const resultado = await job.avisarPedidosDeOntem();

    /* Pedido 1 falhou e foi pulado (logado); pedido 2 seguiu normalmente. */
    expect(messaging.notificar).toHaveBeenCalledTimes(1);
    expect(resultado.enviados).toBe(1);
  });

  it('varios pedidos elegiveis: processa todos, um a um', async () => {
    const pedidos = [
      PEDIDO_BASE,
      { ...PEDIDO_BASE, id: 'order-2', number: 'A002', customerId: 'customer-2' },
      { ...PEDIDO_BASE, id: 'order-3', number: 'A003', customerId: 'customer-3' },
    ];
    const { job, messaging } = makeJob({ pedidos, saldoCents: 500 });

    const resultado = await job.avisarPedidosDeOntem();

    expect(messaging.notificar).toHaveBeenCalledTimes(3);
    expect(resultado).toEqual({ elegiveis: 3, enviados: 3, semSaldo: 0 });
  });
});
