import { describe, expect, it, vi } from 'vitest';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@adventure/shared';
import { ExpiredPixJob } from './expired-pix.job';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { OrdersService } from './orders.service';

/**
 * PIX que ninguem pagou fica preso em PENDING_PAYMENT para sempre sem
 * este job — e o unico jeito de um pedido nunca finalizado deixar de
 * poluir o Kanban e de colidir visualmente com o numero de outro dia.
 */

function makeJob(pedidos: { id: string; number: string }[] = []) {
  const prisma = {
    order: { findMany: vi.fn().mockResolvedValue(pedidos) },
  } as unknown as PrismaService;

  const orders = {
    updateStatus: vi.fn().mockResolvedValue({}),
  } as unknown as OrdersService;

  return { job: new ExpiredPixJob(prisma, orders), prisma, orders };
}

describe('ExpiredPixJob.cancelarPixVencidos', () => {
  it('sem pedido vencido, nao chama updateStatus e nao conta nada', async () => {
    const { job, orders } = makeJob([]);

    const resultado = await job.cancelarPixVencidos();

    expect(resultado).toEqual({ cancelados: 0 });
    expect(orders.updateStatus).not.toHaveBeenCalled();
  });

  it('consulta so PENDING_PAYMENT + PIX com pagamento pendente vencido ha mais de 10min', async () => {
    const { job, prisma } = makeJob([]);

    await job.cancelarPixVencidos();

    const consulta = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(consulta.where.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(consulta.where.paymentMethod).toBe(PaymentMethod.PIX);
    expect(consulta.where.payments.some.status).toBe(PaymentStatus.PENDING);

    /* A margem existe para nao cancelar um pedido cujo webhook de
       pagamento so esta um pouco atrasado — o limite de corte precisa
       estar no passado, nao no exato instante do vencimento. */
    const limite = consulta.where.payments.some.pixExpiresAt.lt as Date;
    expect(limite.getTime()).toBeLessThan(Date.now() - 9 * 60_000);
  });

  it('cancela cada pedido vencido com o motivo certo', async () => {
    const { job, orders } = makeJob([
      { id: 'o1', number: 'A001' },
      { id: 'o2', number: 'A002' },
    ]);

    const resultado = await job.cancelarPixVencidos();

    expect(resultado).toEqual({ cancelados: 2 });
    expect(orders.updateStatus).toHaveBeenCalledWith('o1', OrderStatus.CANCELED, {
      reason: 'PIX expirado sem pagamento',
    });
    expect(orders.updateStatus).toHaveBeenCalledWith('o2', OrderStatus.CANCELED, {
      reason: 'PIX expirado sem pagamento',
    });
  });

  it('um pedido que ja saiu de PENDING_PAYMENT entre a consulta e o cancelamento nao derruba o lote', async () => {
    /* Simula a corrida: o pagamento foi confirmado bem nesse meio-tempo,
       e updateStatus lanca ConflictException porque o CAS interno nao
       encontra mais o pedido no status esperado. */
    const { job, orders } = makeJob([
      { id: 'o1', number: 'A001' },
      { id: 'o2', number: 'A002' },
    ]);
    (orders.updateStatus as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Este pedido acabou de ser atualizado por outra acao.'))
      .mockResolvedValueOnce({});

    const resultado = await job.cancelarPixVencidos();

    /* Um falhou (pago na corrida), o outro foi cancelado normalmente. */
    expect(resultado).toEqual({ cancelados: 1 });
    expect(orders.updateStatus).toHaveBeenCalledTimes(2);
  });
});
