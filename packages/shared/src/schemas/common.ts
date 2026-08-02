import { z } from 'zod';

/**
 * Validadores brasileiros reutilizaveis.
 *
 * Regra do projeto: dados sao NORMALIZADOS na validacao (so digitos), para o
 * banco nunca receber "(11) 99999-9999" e "11999999999" como se fossem
 * telefones diferentes. A mascara e responsabilidade da interface.
 */

const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** Celular brasileiro com DDD e o 9 na frente. Guardado apenas com digitos. */
export const phoneSchema = z
  .string()
  .transform(onlyDigits)
  .pipe(
    z
      .string()
      .regex(/^[1-9]{2}9\d{8}$/, 'Informe um celular valido com DDD. Ex.: (11) 99999-9999'),
  );

export const cepSchema = z
  .string()
  .transform(onlyDigits)
  .pipe(z.string().regex(/^\d{8}$/, 'CEP deve ter 8 digitos'));

export const cpfSchema = z
  .string()
  .transform(onlyDigits)
  .pipe(z.string().length(11, 'CPF deve ter 11 digitos'))
  .refine(isValidCpf, 'CPF invalido');

/** Valida CPF pelos digitos verificadores, nao apenas pelo formato. */
function isValidCpf(cpf: string): boolean {
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);
  for (let position = 9; position < 11; position++) {
    let sum = 0;
    for (let i = 0; i < position; i++) {
      sum += (digits[i] ?? 0) * (position + 1 - i);
    }
    const remainder = (sum * 10) % 11 % 10;
    if (remainder !== digits[position]) return false;
  }
  return true;
}

export const emailSchema = z.string().trim().toLowerCase().email('E-mail invalido');

export const uuidSchema = z.string().uuid('Identificador invalido');

/** Inteiro nao negativo em centavos — ver money.ts. */
export const centsSchema = z
  .number()
  .int('Valor deve ser inteiro em centavos')
  .nonnegative('Valor nao pode ser negativo');

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug invalido');

/** Paginacao por cursor: nao degrada em tabelas grandes, ao contrario do OFFSET. */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const dateRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((range) => range.from <= range.to, {
    message: 'Data inicial deve ser anterior a data final',
    path: ['from'],
  });
export type DateRange = z.infer<typeof dateRangeSchema>;
