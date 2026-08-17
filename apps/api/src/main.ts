import 'dotenv/config';
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
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
    logger:
      env.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'],
    /**
     * Guarda o corpo BRUTO das requisicoes, alem do JSON ja parseado.
     *
     * O webhook do WhatsApp assina o corpo exato que enviou (HMAC-SHA256
     * com o App Secret). Reserializar o objeto ja parseado mudaria
     * espacos e ordem de chaves, e a assinatura nunca bateria — a
     * verificacao precisa dos bytes originais.
     */
    rawBody: true,
  });

  app.setGlobalPrefix('api/v1');

  /* Necessario para ler o refresh token, que fica em cookie httpOnly. */
  app.use(cookieParser());

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

  /**
   * A cadeia real e Cloudflare -> proxy do Railway -> app: DOIS saltos,
   * nao um. Com `1`, o `req.ip` parava na borda do Cloudflare em vez de
   * chegar no cliente.
   *
   * Isso afeta principalmente o rate limiting — que, por seguranca, nao
   * depende so disto: o IpRealThrottlerGuard usa o cabecalho
   * `CF-Connecting-IP`, posto pelo proprio Cloudflare e nao falsificavel
   * pelo cliente. Ver o comentario la.
   */
  app.set('trust proxy', 2);

  app.useGlobalFilters(new ProblemDetailsFilter());

  /* Fecha conexoes do Prisma ao receber SIGTERM, evitando derrubar pedido em voo. */
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');

  logger.log(`API no ar em http://localhost:${env.PORT}/api/v1`);
  logger.log(`Ambiente: ${env.NODE_ENV}`);
  logger.log(`Origens permitidas: ${env.CORS_ORIGINS.join(', ') || '(nenhuma)'}`);
}

void bootstrap();
