import 'dotenv/config';
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  /* Valida o ambiente ANTES de subir qualquer coisa: se algo estiver
     faltando, o processo morre aqui e nao meio atendendo requisicoes. */
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
  });

  app.setGlobalPrefix('api/v1');

  /* Cabecalhos de seguranca. CSP fica desligada porque a API devolve JSON,
     nao HTML; quem serve pagina e o storefront. */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  /**
   * CORS por allowlist explicita, nunca "*".
   * Requisicoes sem Origin (curl, health check do balanceador) sao aceitas
   * porque nao partem de um navegador e, portanto, nao carregam cookie de
   * sessao de outro site.
   */
  app.enableCors({
    origin(origin, callback) {
      if (!origin || env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origem nao permitida pelo CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  });

  /* Confia no proxy para que o rate limiting enxergue o IP real do cliente,
     e nao o do load balancer. */
  app.set('trust proxy', 1);

  app.useGlobalFilters(new ProblemDetailsFilter());

  /* Fecha conexoes do Prisma ao receber SIGTERM, evitando derrubar pedido em voo. */
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');

  logger.log(`API no ar em http://localhost:${env.PORT}/api/v1`);
  logger.log(`Ambiente: ${env.NODE_ENV}`);
  logger.log(`Origens permitidas: ${env.CORS_ORIGINS.join(', ') || '(nenhuma)'}`);
}

void bootstrap();
