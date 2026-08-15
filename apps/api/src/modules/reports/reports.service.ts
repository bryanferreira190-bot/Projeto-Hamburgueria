import { Injectable } from '@nestjs/common';
import { OrderStatus, type DashboardData, type KpiComparison } from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Fuso da operacao — agrupar por dia em UTC jogaria a madrugada para o dia errado. */
const TIMEZONE = 'America/Sao_Paulo';

/** Pedido cancelado nao entra em faturamento nem em produto mais vendido. */
const FATURAVEIS: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.AWAITING_PICKUP,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todos os dados do dashboard em uma unica chamada.
   *
   * Um endpoint so, em vez de seis, evita seis idas ao servidor e o efeito
   * de graficos aparecendo em momentos diferentes na tela.
   */
  async getDashboard(from: Date, to: Date): Promise<DashboardData> {
    /* Periodo anterior de mesma duracao, para as comparacoes. */
    const durationMs = to.getTime() - from.getTime();
    const previousFrom = new Date(from.getTime() - durationMs);

    const [current, previous, revenueByDay, topProducts, byPaymentMethod, byHour, byType] =
      await Promise.all([
        this.aggregate(from, to),
        this.aggregate(previousFrom, from),
        this.revenueByDay(from, to),
        this.topProducts(from, to),
        this.byPaymentMethod(from, to),
        this.byHour(from, to),
        this.byType(from, to),
      ]);

    const canceled = await this.prisma.order.count({
      where: { status: OrderStatus.CANCELED, createdAt: { gte: from, lte: to } },
    });

    const totalOrders = current.ordersCount + canceled;

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        revenueCents: compare(current.revenueCents, previous.revenueCents),
        ordersCount: compare(current.ordersCount, previous.ordersCount),
        avgTicketCents: compare(current.avgTicketCents, previous.avgTicketCents),
        canceledCount: canceled,
        cancelRatePercent: totalOrders === 0 ? 0 : round2((canceled / totalOrders) * 100),
      },
      revenueByDay,
      topProducts,
      byPaymentMethod,
      byHour,
      byType,
    };
  }

  private async aggregate(from: Date, to: Date) {
    const result = await this.prisma.order.aggregate({
      where: { status: { in: FATURAVEIS }, createdAt: { gte: from, lte: to } },
      _sum: { totalCents: true },
      _count: { _all: true },
    });

    const revenueCents = result._sum.totalCents ?? 0;
    const ordersCount = result._count._all;

    return {
      revenueCents,
      ordersCount,
      avgTicketCents: ordersCount === 0 ? 0 : Math.round(revenueCents / ordersCount),
    };
  }

  /**
   * Faturamento diario. O date_trunc converte para o fuso da loja antes de
   * agrupar, senao um pedido das 22h30 cairia no dia seguinte.
   */
  private async revenueByDay(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{ date: Date; revenue: bigint; orders: bigint }[]>`
      SELECT
        date_trunc('day', "createdAt" AT TIME ZONE ${TIMEZONE})::date AS date,
        COALESCE(SUM("totalCents"), 0)::bigint AS revenue,
        COUNT(*)::bigint AS orders
      FROM "order"
      WHERE "createdAt" BETWEEN ${from} AND ${to}
        AND "status" = ANY(${FATURAVEIS}::"OrderStatus"[])
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      revenueCents: Number(row.revenue),
      ordersCount: Number(row.orders),
    }));
  }

  private async topProducts(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      { productId: string; name: string; quantity: bigint; revenue: bigint }[]
    >`
      SELECT
        oi."productId"      AS "productId",
        oi."productName"    AS name,
        SUM(oi."quantity")::bigint  AS quantity,
        SUM(oi."totalCents")::bigint AS revenue
      FROM "order_item" oi
      JOIN "order" o ON o."id" = oi."orderId"
      WHERE o."createdAt" BETWEEN ${from} AND ${to}
        AND o."status" = ANY(${FATURAVEIS}::"OrderStatus"[])
      GROUP BY 1, 2
      ORDER BY quantity DESC
      LIMIT 10
    `;

    return rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      quantity: Number(row.quantity),
      revenueCents: Number(row.revenue),
    }));
  }

  private async byPaymentMethod(from: Date, to: Date) {
    const rows = await this.prisma.order.groupBy({
      by: ['paymentMethod'],
      where: { status: { in: FATURAVEIS }, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { totalCents: true },
    });

    return rows
      .map((row) => ({
        method: row.paymentMethod,
        count: row._count._all,
        revenueCents: row._sum.totalCents ?? 0,
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);
  }

  /**
   * Movimento por hora do dia — apoia a decisao de escala de equipe.
   * Devolve as 24 horas, inclusive as vazias, para o grafico nao ficar com
   * buracos e sugerir que faltou dado.
   */
  private async byHour(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{ hour: number; orders: bigint; revenue: bigint }[]>`
      SELECT
        EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${TIMEZONE})::int AS hour,
        COUNT(*)::bigint AS orders,
        COALESCE(SUM("totalCents"), 0)::bigint AS revenue
      FROM "order"
      WHERE "createdAt" BETWEEN ${from} AND ${to}
        AND "status" = ANY(${FATURAVEIS}::"OrderStatus"[])
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const byHour = new Map(rows.map((row) => [row.hour, row]));

    return Array.from({ length: 24 }, (_, hour) => {
      const row = byHour.get(hour);
      return {
        hour,
        ordersCount: row ? Number(row.orders) : 0,
        revenueCents: row ? Number(row.revenue) : 0,
      };
    });
  }

  private async byType(from: Date, to: Date) {
    const rows = await this.prisma.order.groupBy({
      by: ['type'],
      where: { status: { in: FATURAVEIS }, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    });

    return {
      delivery: rows.find((row) => row.type === 'DELIVERY')?._count._all ?? 0,
      pickup: rows.find((row) => row.type === 'PICKUP')?._count._all ?? 0,
    };
  }

  /** Relatorio de vendas em CSV, para abrir no Excel. */
  async exportSalesCsv(from: Date, to: Date): Promise<string> {
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
      include: { customer: { select: { name: true, phone: true } } },
    });

    const header = [
      'numero',
      'data',
      'status',
      'tipo',
      'cliente',
      'telefone',
      'origem',
      'bairro',
      'subtotal',
      'entrega',
      'desconto',
      'total',
      'pagamento',
    ];

    const rows = orders.map((order) => [
      order.number,
      order.createdAt.toISOString(),
      order.status,
      order.type,
      /* Pedido de balcao pode nao ter cliente cadastrado; nesse caso o
         nome dito no balcao e tudo que existe, e telefone fica vazio. */
      order.customer?.name ?? order.manualCustomerName ?? '',
      order.customer?.phone ?? '',
      order.isManual ? 'balcao' : 'site',
      order.addressDistrict ?? '',
      cents(order.subtotalCents),
      cents(order.deliveryFeeCents),
      cents(order.discountCents),
      cents(order.totalCents),
      order.paymentMethod,
    ]);

    return [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
  }
}

function compare(value: number, previous: number): KpiComparison {
  /* Sem base de comparacao, devolvemos null em vez de 0% ou 100%, que
     seriam numeros inventados. */
  const changePercent = previous === 0 ? null : round2(((value - previous) / previous) * 100);
  return { value, previous, changePercent };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Centavos para o formato numerico que o Excel brasileiro entende. */
function cents(value: number): string {
  return (value / 100).toFixed(2).replace('.', ',');
}

function csvCell(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
