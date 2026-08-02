import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import {
  AdminRole,
  reportPeriodSchema,
  type DashboardData,
  type ReportPeriod,
} from '@adventure/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequireRole } from '../auth/decorators';
import { ReportsService } from './reports.service';

/**
 * Relatorios e dashboard.
 *
 * Exigem MANAGER: faturamento e ticket medio sao informacao estrategica,
 * que a cozinha e a entrega nao precisam ver.
 */
@RequireRole(AdminRole.MANAGER)
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  getDashboard(
    @Query(new ZodValidationPipe(reportPeriodSchema)) period: ReportPeriod,
  ): Promise<DashboardData> {
    return this.reports.getDashboard(period.from, period.to);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vendas.csv"')
  async exportCsv(
    @Query(new ZodValidationPipe(reportPeriodSchema)) period: ReportPeriod,
  ): Promise<StreamableFile> {
    const csv = await this.reports.exportSalesCsv(period.from, period.to);

    /* BOM no inicio: sem ele o Excel abre a acentuacao errada.
       Construido por codigo — como caractere literal seria invisivel no
       fonte e vira bug dificil de rastrear. */
    const bom = String.fromCharCode(0xfeff);
    return new StreamableFile(Buffer.from(`${bom}${csv}`, 'utf8'));
  }
}
