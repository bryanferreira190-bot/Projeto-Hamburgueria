import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CryptoModule } from './common/crypto/crypto.module';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminAuthGuard } from './modules/auth/guards/admin-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { StoreModule } from './modules/store/store.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CryptoModule,

    /**
     * Rate limiting em tres janelas simultaneas. Todas precisam ser
     * respeitadas, o que barra tanto rajada curta quanto abuso sustentado.
     * Login e OTP tem limites proprios, definidos no controller.
     */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'medium', ttl: 10_000, limit: 40 },
      { name: 'long', ttl: 60_000, limit: 120 },
    ]),

    AuthModule,
    HealthModule,
    StoreModule,
    CatalogModule,
  ],
  providers: [
    /**
     * A ordem importa: throttler barra excesso antes de gastar CPU com
     * verificacao de token; a autenticacao popula o usuario; so entao a
     * autorizacao por papel decide.
     *
     * O AdminAuthGuard fecha TODAS as rotas por padrao. Abrir exige @Public().
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AdminAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
