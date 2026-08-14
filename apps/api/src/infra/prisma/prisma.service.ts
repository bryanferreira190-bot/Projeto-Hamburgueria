import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma com ciclo de vida ligado ao do NestJS.
 *
 * Conectar na inicializacao faz o processo falhar cedo se o banco estiver
 * inacessivel — melhor do que descobrir na primeira requisicao de um cliente.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],

      /**
       * LIMITES DE TRANSACAO FOLGADOS, DE PROPOSITO
       *
       * O banco (Neon) encerra a conexao quando fica ocioso. O primeiro
       * pedido depois de uma pausa cai numa transacao que precisa
       * reconectar antes de rodar as consultas — e so a reconexao ja
       * consome alguns segundos a partir do Railway.
       *
       * Com o padrao do Prisma (5s), isso estourava o limite e derrubava
       * a criacao do pedido com "Transaction already closed" (5191ms
       * medidos em producao). O cliente via "erro inesperado" e o pedido
       * nem chegava a ser gravado; tentar de novo funcionava, porque a
       * conexao ja estava quente.
       *
       * Nao e mascarar lentidao: a transacao em si leva ~700ms com a
       * conexao ativa. A folga existe para o caso excepcional da
       * reconexao, e nao muda nada no caminho normal.
       */
      transactionOptions: {
        /* Tempo para conseguir uma conexao antes de comecar (padrao 2s). */
        maxWait: 10_000,
        /* Tempo total da transacao (padrao 5s). */
        timeout: 20_000,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    const startedAt = Date.now();
    await this.$connect();
    this.logger.log(`Banco conectado em ${Date.now() - startedAt}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Ping usado pelo health check. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Health check do banco falhou', error);
      return false;
    }
  }
}
