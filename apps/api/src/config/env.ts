import { z } from 'zod';

/**
 * AMBIENTE VALIDADO
 *
 * O processo falha na inicializacao se alguma variavel estiver ausente ou
 * malformada. Isso e proposital: e melhor o servidor recusar-se a subir do
 * que atender requisicoes com JWT_SECRET vazio ou banco errado.
 */

const MIN_SECRET_LENGTH = 32;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),

  DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL de conexao valida'),
  REDIS_URL: z.string().url().optional().or(z.literal('')),

  JWT_ACCESS_SECRET: z.string().min(MIN_SECRET_LENGTH, secretMessage('JWT_ACCESS_SECRET')),
  JWT_REFRESH_SECRET: z.string().min(MIN_SECRET_LENGTH, secretMessage('JWT_REFRESH_SECRET')),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  /* Lista separada por virgula; o CORS opera por allowlist, nunca "*". */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  MERCADOPAGO_ACCESS_TOKEN: z.string().optional().or(z.literal('')),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional().or(z.literal('')),
  WHATSAPP_PHONE_NUMBER: z.string().optional().or(z.literal('')),
});

function secretMessage(name: string): string {
  return `${name} precisa ter ao menos ${MIN_SECRET_LENGTH} caracteres. Gere com: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`;
}

export type Env = z.infer<typeof envSchema>;

/**
 * Valida process.env e devolve o ambiente tipado.
 * Em producao, exige que os segredos tenham sido de fato trocados.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variaveis de ambiente invalidas:\n${details}`);
  }

  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    const placeholders = (['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const).filter((key) =>
      env[key].includes('trocar_este_valor'),
    );
    if (placeholders.length > 0) {
      throw new Error(
        `Segredos ainda com valor de exemplo em producao: ${placeholders.join(', ')}`,
      );
    }
    if (env.CORS_ORIGINS.length === 0) {
      throw new Error('CORS_ORIGINS nao pode ficar vazio em producao');
    }
  }

  return env;
}
