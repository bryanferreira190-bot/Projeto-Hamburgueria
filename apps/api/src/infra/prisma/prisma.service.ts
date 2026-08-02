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
