import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { formatBRL } from '@adventure/shared';
import { STORE_TIMEZONE, hojeNoFusoDaLoja } from '../../common/timezone';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CashbackService } from './cashback.service';

/**
 * Ate quanto tempo o job pode gastar mandando aviso. Ver o uso, dentro
 * do laco de envio.
 */
const TETO_DE_EXECUCAO_MS = 15 * 60_000;

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
    let simulados = 0;
    const limiteDeTempo = Date.now() + TETO_DE_EXECUCAO_MS;

    for (const cliente of porCliente.values()) {
      /**
       * Teto de tempo: o envio e sequencial e cada mensagem pode custar
       * ate ~30s no pior caso (Meta fora do ar + tentativas). Sem isto,
       * uma noite ruim deixaria o job rodando por horas, atravessando o
       * horario de pico. Quem sobrar continua elegivel amanha — o filtro
       * `expiryWarningSentAt: null` garante isso.
       */
      if (Date.now() > limiteDeTempo) {
        this.logger.warn(
          `Teto de tempo do aviso de cashback atingido; ${porCliente.size - enviados - simulados} cliente(s) ficaram para a proxima execucao.`,
        );
        break;
      }

      const resultado = await this.whatsapp.sendCashbackExpiring(
        cliente.telefone,
        cliente.nome,
        formatBRL(cliente.totalCents),
      );

      /**
       * Falha GLOBAL para o job inteiro: credencial errada, numero da
       * loja nao registrado ou limite de 24h da conta nao melhoram no
       * proximo cliente. Insistir cliente a cliente so multiplicaria a
       * chamada perdida e encheria o log com o mesmo erro.
       */
      if (
        resultado.erro &&
        (['CREDENCIAL_INVALIDA', 'CONFIGURACAO_INVALIDA', 'LIMITE_EXCEDIDO'] as const).includes(
          resultado.erro.tipo as 'CREDENCIAL_INVALIDA',
        )
      ) {
        this.logger.error(
          `Aviso de cashback interrompido — ${resultado.erro.tipo}: ${resultado.erro.mensagem}`,
        );
        break;
      }

      if (!resultado.enviado) continue;

      if (resultado.simulado) {
        /**
         * Envio esta desligado (WHATSAPP_ENABLED=false): NAO carimba.
         *
         * Carimbar aqui marcaria o aviso como enviado sem que nada
         * tenha saido — e no dia em que a integracao fosse ligada,
         * esses clientes ja apareceriam como "avisados" e nunca
         * receberiam a mensagem.
         */
        simulados += 1;
        continue;
      }

      /* So carimba depois do envio REAL confirmado: se a Meta recusou,
         o cliente continua elegivel para a proxima tentativa. */
      await this.prisma.cashbackCredit.updateMany({
        where: { id: { in: cliente.creditoIds } },
        data: { expiryWarningSentAt: new Date() },
      });
      enviados += 1;
    }

    this.logger.log(
      `Cashback expirando amanha: ${porCliente.size} cliente(s), ${enviados} aviso(s) enviado(s)` +
        (simulados > 0 ? `, ${simulados} simulado(s) (WHATSAPP_ENABLED=false)` : ''),
    );
    return { clientes: porCliente.size, enviados };
  }
}
