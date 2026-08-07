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

  /**
   * Endereco publico da API (ex.: https://api.impactdev.site).
   *
   * Serve para montar a URL absoluta das fotos de produto. Em producao a
   * loja e a API moram em dominios diferentes, entao devolver so o caminho
   * ("/api/v1/...") obrigaria cada frontend a adivinhar o prefixo.
   *
   * Vazio em desenvolvimento de proposito: ali o proxy do Vite coloca
   * front e API na mesma origem, e o caminho relativo funciona melhor.
   */
  PUBLIC_API_URL: z
    .string()
    .url('PUBLIC_API_URL deve ser uma URL completa, como https://api.impactdev.site')
    .or(z.literal(''))
    .default('')
    /* Barra no fim geraria "//api/v1" na concatenacao. */
    .transform((value) => value.replace(/\/+$/, '')),

  JWT_ACCESS_SECRET: z.string().min(MIN_SECRET_LENGTH, secretMessage('JWT_ACCESS_SECRET')),
  JWT_REFRESH_SECRET: z.string().min(MIN_SECRET_LENGTH, secretMessage('JWT_REFRESH_SECRET')),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  /* Cifra o segredo TOTP em repouso. Perder esta chave invalida os 2FA ativos. */
  ENCRYPTION_KEY: z.string().min(MIN_SECRET_LENGTH, secretMessage('ENCRYPTION_KEY')),

  /* Quantas falhas de senha antes de bloquear a conta temporariamente. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  /**
   * Exige segunda etapa para OWNER e MANAGER.
   *
   * Existe apenas para nao atrapalhar o desenvolvimento local. Em producao
   * o valor e FORCADO para true mais abaixo — a conta OWNER controla
   * faturamento e cadastro, e senha sozinha nao basta para isso.
   */
  REQUIRE_ADMIN_2FA: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

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
    const placeholders = (
      ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const
    ).filter((key) => env[key].includes('trocar_este_valor'));
    if (placeholders.length > 0) {
      throw new Error(
        `Segredos ainda com valor de exemplo em producao: ${placeholders.join(', ')}`,
      );
    }
    if (env.CORS_ORIGINS.length === 0) {
      throw new Error('CORS_ORIGINS nao pode ficar vazio em producao');
    }

    /* Reaproveitar o mesmo segredo faz um token de refresh valer como access. */
    const secrets = [env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.ENCRYPTION_KEY];
    if (new Set(secrets).size !== secrets.length) {
      throw new Error('JWT_ACCESS_SECRET, JWT_REFRESH_SECRET e ENCRYPTION_KEY devem ser distintos');
    }

    /* Nao e configuravel em producao: sobrescreve qualquer valor do .env. */
    env.REQUIRE_ADMIN_2FA = true;
  }

  return env;
}
