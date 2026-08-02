import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Endpoints de saude, usados por balanceador de carga e monitoramento.
 * Ficam fora do rate limiting: o monitor consulta com frequencia alta.
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: o processo esta de pe? */
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: da para atender requisicoes de verdade (banco acessivel)? */
  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    const databaseUp = await this.prisma.isHealthy();

    if (!databaseUp) {
      throw new ServiceUnavailableException('Banco de dados indisponivel');
    }

    return { status: 'ok', database: 'up' };
  }
}
