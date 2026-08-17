import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CryptoModule } from './common/crypto/crypto.module';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminAuthGuard } from './modules/auth/guards/admin-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { CashbackModule } from './modules/cashback/cashback.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StoreModule } from './modules/store/store.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CryptoModule,

    /**
     * Rate limiting em tres janelas simultaneas. Todas precisam ser
     * respeitadas, o que barra tanto rajada curta quanto abuso sustentado.
     *
     * A JANELA DE 1 MINUTO PRECISA SE CHAMAR "default". O decorator
     * `@Throttle({ default: { ... } })`, usado em login, criacao de
     * pedido, rastreio e webhooks, procura um throttler com ESSE nome
     * exato — com qualquer outro nome (era "long"), a metadata nunca e
     * encontrada e o limite por rota simplesmente NAO VALE, silenciosamente.
     * Confirmado na pratica: 8 chamadas seguidas passavam numa rota que
     * declarava limite de 5/min. Ver DECISOES.md.
     */
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 10 },
      { name: 'medium', ttl: 10_000, limit: 40 },
      { name: 'default', ttl: 60_000, limit: 120 },
    ]),

    /* Tarefas com hora marcada — hoje so o aviso diario de cashback
       expirando. Ver CashbackExpiryJob. */
    ScheduleModule.forRoot(),

    AuthModule,
    HealthModule,
    StoreModule,
    CatalogModule,
    DeliveryModule,
    OrdersModule,
    PaymentsModule,
    ReportsModule,
    CashbackModule,
    WhatsAppModule,
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
