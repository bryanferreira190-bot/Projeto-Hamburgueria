import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OrdersService } from './orders.service';

/**
 * Margem depois do vencimento do PIX antes de cancelar de fato.
 *
 * O webhook do Mercado Pago pode chegar alguns segundos depois do
 * `pixExpiresAt` mesmo quando o cliente pagou dentro do prazo (fila do
 * provedor, latencia de rede). Cancelar exatamente no instante do
 * vencimento arriscaria cancelar um pedido que, na pratica, foi pago —
 * e como `avancarPedidoConformePagamento` (PaymentsService) so age em
 * pedido ainda PENDING_PAYMENT, um webhook atrasado depois do
 * cancelamento seria silenciosamente ignorado. A margem da tempo para
 * esse atraso normal acontecer antes de desistir do pedido.
 */
const MARGEM_APOS_VENCIMENTO_MS = 10 * 60_000;

/**
 * CANCELAMENTO AUTOMATICO DE PIX VENCIDO
 *
 * So o PIX fica parado em PENDING_PAYMENT esperando o cliente pagar —
 * cartao resolve na hora, aprovado ou recusado, na propria chamada
 * (ver OrdersService.create). Sem este job, um QR code que ninguem
 * escaneou fica preso ali PARA SEMPRE: nenhuma tela do painel tem
 * botao para isso (PENDING_PAYMENT so anda sozinho, via webhook), e o
 * pedido nunca finalizado polui o Kanban e colide visualmente com
 * pedidos novos de outro dia que reusam o mesmo numero (numeracao
 * reinicia por dia — ver DECISOES.md).
 *
 * Roda a cada 10 minutos: frequente o bastante para o pedido nao ficar
 * exposto por horas, sem gerar carga desnecessaria.
 */
@Injectable()
export class ExpiredPixJob {
  private readonly logger = new Logger(ExpiredPixJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  @Cron('*/10 * * * *')
  async executar(): Promise<void> {
    await this.cancelarPixVencidos();
  }

  /** Separado do @Cron para poder ser chamado a mao (teste, script). */
  async cancelarPixVencidos(): Promise<{ cancelados: number }> {
    const limite = new Date(Date.now() - MARGEM_APOS_VENCIMENTO_MS);

    const expirados = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.PIX,
        payments: {
          some: { status: PaymentStatus.PENDING, pixExpiresAt: { lt: limite } },
        },
      },
      select: { id: true, number: true },
    });

    if (expirados.length === 0) return { cancelados: 0 };

    let cancelados = 0;
    for (const pedido of expirados) {
      try {
        /* CAS dentro de updateStatus protege contra corrida com o
           webhook: se o pagamento acabou de ser confirmado entre o
           findMany acima e este cancelamento, o updateMany interno
           nao encontra mais o pedido em PENDING_PAYMENT e lanca
           ConflictException — capturado abaixo, sem quebrar o lote. */
        await this.orders.updateStatus(pedido.id, OrderStatus.CANCELED, {
          reason: 'PIX expirado sem pagamento',
        });
        cancelados += 1;
      } catch (error) {
        this.logger.warn(
          `Pedido ${pedido.number} nao cancelado (provavelmente pago entre a consulta e agora): ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(`PIX vencido: ${cancelados}/${expirados.length} pedido(s) cancelado(s)`);
    return { cancelados };
  }
}
