import { z } from 'zod';

/**
 * Periodo dos relatorios.
 *
 * Sem datas informadas, usa os ultimos 30 dias — janela que responde a
 * pergunta mais comum ("como foi o mes?") sem o gestor precisar preencher nada.
 */
export const reportPeriodSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform((value) => {
    const to = value.to ?? new Date();
    const from = value.from ?? new Date(to.getTime() - 30 * 86_400_000);
    return { from, to };
  })
  .refine((range) => range.from <= range.to, {
    message: 'A data inicial precisa ser anterior a final',
  });
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

export const salesReportSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    groupBy: z.enum(['day', 'week', 'month']).default('day'),
  })
  .transform((value) => {
    const to = value.to ?? new Date();
    const from = value.from ?? new Date(to.getTime() - 30 * 86_400_000);
    return { from, to, groupBy: value.groupBy };
  });
export type SalesReportInput = z.infer<typeof salesReportSchema>;

/* ---------------- Formato das respostas ---------------- */

export interface KpiComparison {
  value: number;
  previous: number;
  /** Variacao percentual contra o periodo anterior de mesma duracao. */
  changePercent: number | null;
}

export interface DashboardData {
  period: { from: string; to: string };
  kpis: {
    revenueCents: KpiComparison;
    ordersCount: KpiComparison;
    avgTicketCents: KpiComparison;
    canceledCount: number;
    cancelRatePercent: number;
  };
  revenueByDay: { date: string; revenueCents: number; ordersCount: number }[];
  topProducts: { productId: string; name: string; quantity: number; revenueCents: number }[];
  byPaymentMethod: { method: string; count: number; revenueCents: number }[];
  byHour: { hour: number; ordersCount: number; revenueCents: number }[];
  byType: { delivery: number; pickup: number };
}
