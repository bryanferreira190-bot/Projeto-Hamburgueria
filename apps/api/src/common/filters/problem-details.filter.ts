import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * Formato de erro unico da API, seguindo a RFC 7807 (application/problem+json).
 *
 * Duas garantias importantes:
 *  - o cliente sempre recebe a mesma forma de erro, facil de tratar;
 *  - detalhes internos (stack, SQL, nome de tabela) nunca chegam ao cliente,
 *    apenas ao log do servidor.
 */
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: { field: string; message: string }[];
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, request.url);

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${problem.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof ZodError) {
      return {
        type: 'https://httpstatuses.io/422',
        title: 'Dados invalidos',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        instance,
        errors: exception.issues.map((issue) => ({
          field: issue.path.join('.') || '(raiz)',
          message: issue.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const detail =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);

      return {
        type: `https://httpstatuses.io/${status}`,
        title: exception.name.replace(/Exception$/, ''),
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        instance,
      };
    }

    /* Erro nao previsto: mensagem generica ao cliente, detalhe so no log. */
    return {
      type: 'https://httpstatuses.io/500',
      title: 'Erro interno',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
      instance,
    };
  }
}
