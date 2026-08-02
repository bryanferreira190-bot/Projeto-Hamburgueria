import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Valida a entrada com um schema Zod de @adventure/shared.
 *
 * Usar o mesmo schema no backend e no frontend garante que a regra de
 * validacao exista em um lugar so. O erro do Zod e convertido em resposta
 * padronizada pelo ProblemDetailsFilter.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
