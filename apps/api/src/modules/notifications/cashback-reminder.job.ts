import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationEvent, OrderStatus } from '@adventure/shared';
import { STORE_TIMEZONE, hojeNoFusoDaLoja } from '../../common/timezone';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CashbackService } from '../cashback/cashback.service';
import { MessagingService } from './messaging.service';

/** Mesmo raciocinio do aviso de cashback vencendo: teto para o lote inteiro nao virar horas. */
const TETO_DE_EXECUCAO_MS = 15 * 60_000;

/**
 * LEMBRETE DE CASHBACK NO DIA SEGUINTE AO PEDIDO
 *
 * Roda uma vez por dia, as 11h no fuso da loja, e manda para quem fez
 * pedido ONTEM (qualquer status exceto CANCELED) um lembrete do saldo
 * de cashback disponivel — nao e sobre o pedido em si, e um empurrao
 * para o cliente voltar.
 *
 * Nao inventa nada novo: reaproveita CashbackService.saldoDoCliente
 * (mesma consulta de sempre, so sem passar pelo telefone porque o
 * pedido ja tem customerId) e MessagingService.notificar() (mesmo
 * pipeline de template/idempotencia/log/Evolution dos outros 5
 * eventos) via o evento CASHBACK_REMINDER. O saldo e sempre consultado
 * NA HORA do envio, nunca guardado do momento do pedido — pode ter
 * mudado (novo credito, novo gasto) entre a compra e o dia seguinte.
 *
 * Cliente com saldo zero: nao manda mensagem nenhuma, de proposito
 * (pedido explicito do dono). Como o pedido so entra na janela de
 * "ontem" NESTE dia — a consulta do dia seguinte ja olha para outro
 * intervalo de datas — nao ha necessidade de marcar nada: o pedido
 * simplesmente sai de escopo sozinho depois de hoje, sem risco de
 * "tentar de novo pra sempre" nem de "nunca mais tentar".
 */
@Injectable()
export class CashbackReminderJob {
  private readonly logger = new Logger(CashbackReminderJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashback: CashbackService,
    private readonly messaging: MessagingService,
  ) {}

  @Cron('0 11 * * *', { timeZone: STORE_TIMEZONE })
  async executar(): Promise<void> {
    await this.avisarPedidosDeOntem();
  }

  /** Separado do @Cron para poder ser chamado a mao (teste, script). */
  async avisarPedidosDeOntem(): Promise<{ elegiveis: number; enviados: number; semSaldo: number }> {
    const inicioDeHoje = hojeNoFusoDaLoja();
    const inicioDeOntem = new Date(inicioDeHoje);
    inicioDeOntem.setDate(inicioDeOntem.getDate() - 1);

    const pedidos = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: inicioDeOntem, lt: inicioDeHoje },
        status: { not: OrderStatus.CANCELED },
        customerId: { not: null },
      },
      select: {
        id: true,
        number: true,
        storeId: true,
        totalCents: true,
        status: true,
        customerId: true,
        customer: { select: { name: true, phone: true } },
      },
    });

    if (pedidos.length === 0) {
      this.logger.log('Lembrete de cashback: nenhum pedido de ontem — nada a avisar');
      return { elegiveis: 0, enviados: 0, semSaldo: 0 };
    }

    /* Idempotencia via NotificationLog — a MESMA tabela e o MESMO
       criterio (orderId + event + success) que os outros 5 eventos ja
       usam dentro de MessagingService.notificar(). So filtra aqui ANTES
       de consultar saldo/mandar, para nao gastar a consulta de cashback
       a toa num pedido que ja foi avisado (job rodou de novo no mesmo
       dia: redeploy, execucao manual). */
    const jaAvisados = await this.prisma.notificationLog.findMany({
      where: {
        orderId: { in: pedidos.map((pedido) => pedido.id) },
        event: NotificationEvent.CASHBACK_REMINDER,
        success: true,
      },
      select: { orderId: true },
    });
    const jaAvisadosIds = new Set(jaAvisados.map((log) => log.orderId));
    const pendentes = pedidos.filter((pedido) => !jaAvisadosIds.has(pedido.id));

    let enviados = 0;
    let semSaldo = 0;
    const limiteDeTempo = Date.now() + TETO_DE_EXECUCAO_MS;

    for (const pedido of pendentes) {
      if (Date.now() > limiteDeTempo) {
        this.logger.warn(
          `Teto de tempo do lembrete de cashback atingido; ${pendentes.length - enviados - semSaldo} pedido(s) ficaram para a proxima execucao (permanecem elegiveis hoje).`,
        );
        break;
      }

      /* customerId nao e null (filtrado na consulta), mas o relacionamento
         opcional deixa o TypeScript inseguro sobre isso — checagem
         defensiva, nunca deveria ser o caso na pratica. */
      if (!pedido.customer || !pedido.customerId) continue;

      try {
        const saldo = await this.cashback.saldoDoCliente(pedido.customerId);

        if (saldo.totalCents <= 0) {
          semSaldo += 1;
          continue;
        }

        const resultado = await this.messaging.notificar(NotificationEvent.CASHBACK_REMINDER, {
          storeId: pedido.storeId,
          orderId: pedido.id,
          orderNumber: pedido.number,
          customerName: pedido.customer.name,
          phone: pedido.customer.phone,
          totalCents: pedido.totalCents,
          status: pedido.status,
        });

        if (resultado.enviado && !resultado.simulado) enviados += 1;
      } catch (error) {
        /* Nunca deixa um pedido com erro (banco, o que for) derrubar o
           lote inteiro nem a API — loga e segue para o proximo. */
        this.logger.error(
          `Falha ao processar lembrete de cashback do pedido ${pedido.number}`,
          error as Error,
        );
      }
    }

    this.logger.log(
      `Lembrete de cashback: ${pedidos.length} pedido(s) de ontem, ${enviados} enviado(s), ` +
        `${semSaldo} sem saldo, ${jaAvisadosIds.size} ja avisado(s) antes.`,
    );
    return { elegiveis: pendentes.length, enviados, semSaldo };
  }
}
