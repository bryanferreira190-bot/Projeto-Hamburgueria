import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { formatBRL } from '@adventure/shared';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { STORE_TIMEZONE, hojeNoFusoDaLoja } from '../../common/timezone';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WhatsAppService } from '../notifications/whatsapp.service';
import { CashbackService } from './cashback.service';

/**
 * AVISO DIARIO DE CASHBACK EXPIRANDO
 *
 * Roda uma vez por dia e manda no WhatsApp de quem tem credito vencendo
 * AMANHA. Um dia de antecedencia e o que da tempo de a pessoa fazer o
 * pedido, mas ainda cria urgencia — avisar no proprio dia do vencimento
 * frustra quem so viu a mensagem a noite.
 *
 * As 10h no fuso da loja: cedo o bastante para a pessoa planejar o
 * jantar, tarde o bastante para nao acordar ninguem. A loja abre as 18h.
 */
@Injectable()
export class CashbackExpiryJob {
  private readonly logger = new Logger(CashbackExpiryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashback: CashbackService,
    private readonly whatsapp: WhatsAppService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Cron('0 10 * * *', { timeZone: STORE_TIMEZONE })
  async executar(): Promise<void> {
    /* Primeiro carimba o que ja venceu: mantem o historico limpo e evita
       o aviso pegar credito que expirou ontem. */
    await this.cashback.expirarVencidos();
    await this.avisarQuemExpiraAmanha();
  }

  /**
   * Separado do @Cron para poder ser chamado a mao (rota administrativa
   * ou script) sem esperar as 10h — util para testar o texto da
   * mensagem antes de deixar no automatico.
   */
  async avisarQuemExpiraAmanha(): Promise<{ clientes: number; enviados: number }> {
    const inicioDeAmanha = hojeNoFusoDaLoja();
    inicioDeAmanha.setDate(inicioDeAmanha.getDate() + 1);

    const fimDeAmanha = new Date(inicioDeAmanha);
    fimDeAmanha.setDate(fimDeAmanha.getDate() + 1);

    const creditos = await this.prisma.cashbackCredit.findMany({
      where: {
        expiresAt: { gte: inicioDeAmanha, lt: fimDeAmanha },
        remainingCents: { gt: 0 },
        /* Ja avisado neste ciclo: nao manda de novo se o job rodar duas
           vezes no mesmo dia (redeploy, execucao manual). */
        expiryWarningSentAt: null,
      },
      select: {
        id: true,
        remainingCents: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    });

    if (creditos.length === 0) {
      this.logger.log('Nenhum cashback expira amanha — nada a avisar');
      return { clientes: 0, enviados: 0 };
    }

    /* Um cliente pode ter varios creditos vencendo no mesmo dia. Manda
       UMA mensagem com o total, nao uma por credito. */
    const porCliente = new Map<
      string,
      { nome: string | null; telefone: string; totalCents: number; creditoIds: string[] }
    >();

    for (const credito of creditos) {
      const atual = porCliente.get(credito.customer.id);
      if (atual) {
        atual.totalCents += credito.remainingCents;
        atual.creditoIds.push(credito.id);
      } else {
        porCliente.set(credito.customer.id, {
          nome: credito.customer.name,
          telefone: credito.customer.phone,
          totalCents: credito.remainingCents,
          creditoIds: [credito.id],
        });
      }
    }

    let enviados = 0;

    for (const cliente of porCliente.values()) {
      const ok = await this.whatsapp.enviarTemplate({
        telefone: cliente.telefone,
        template: this.env.WHATSAPP_TEMPLATE_CASHBACK,
        /* Ordem casada com os {{1}} e {{2}} do template aprovado na
           Meta — ver DECISOES.md para o texto exato submetido. */
        variaveis: [primeiroNome(cliente.nome), formatBRL(cliente.totalCents)],
      });

      if (!ok) continue;

      /* So carimba depois do envio confirmado: se a Meta recusou, o
         cliente continua elegivel para a proxima tentativa. */
      await this.prisma.cashbackCredit.updateMany({
        where: { id: { in: cliente.creditoIds } },
        data: { expiryWarningSentAt: new Date() },
      });
      enviados += 1;
    }

    this.logger.log(
      `Cashback expirando amanha: ${porCliente.size} cliente(s), ${enviados} aviso(s) enviado(s)`,
    );
    return { clientes: porCliente.size, enviados };
  }
}

/** "Joao da Silva" -> "Joao". Sem nome, um tratamento neutro. */
function primeiroNome(nome: string | null): string {
  const primeiro = nome?.trim().split(/\s+/)[0];
  return primeiro && primeiro.length > 1 ? primeiro : 'Tudo bem';
}
