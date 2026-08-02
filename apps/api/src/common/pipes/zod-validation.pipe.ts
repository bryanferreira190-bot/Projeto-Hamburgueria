import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Valida a entrada com um schema Zod de @adventure/shared.
 *
 * Usar o mesmo schema no backend e no frontend garante que a regra de
 * validacao exista em um lugar so. O erro do Zod e convertido em resposta
 * padronizada pelo ProblemDetailsFilter.
 *
 * USE SEMPRE NO PARAMETRO, NUNCA COM @UsePipes:
 *
 *   correto : metodo(@Body(new ZodValidationPipe(schema)) body: T)
 *   errado  : @UsePipes(new ZodValidationPipe(schema))
 *
 * O @UsePipes no metodo aplica o pipe a TODOS os parametros, incluindo os
 * de decorators proprios como @CurrentAdmin. O schema do corpo entao recebe
 * uma string de id para validar e a requisicao falha com 422 sem motivo
 * aparente.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
