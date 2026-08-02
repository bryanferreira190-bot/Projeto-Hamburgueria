import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { StoreModule } from './modules/store/store.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,

    /**
     * Rate limiting em tres janelas simultaneas. Todas precisam ser
     * respeitadas, o que barra tanto rajada curta quanto abuso sustentado.
     * Rotas sensiveis (login, OTP, criacao de pedido) recebem limites
     * proprios e mais rigidos quando forem implementadas.
     */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'medium', ttl: 10_000, limit: 40 },
      { name: 'long', ttl: 60_000, limit: 120 },
    ]),

    HealthModule,
    StoreModule,
    CatalogModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
