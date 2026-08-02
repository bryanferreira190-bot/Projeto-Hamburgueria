import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env';

/** Token de injecao do ambiente validado. */
export const ENV = Symbol('ENV');

/**
 * Disponibiliza o ambiente ja validado para toda a aplicacao.
 * A validacao roda uma unica vez, na inicializacao.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
