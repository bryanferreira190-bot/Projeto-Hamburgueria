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
   * Exige segunda etapa para OWNER e MANAGER (a conta OWNER controla
   * faturamento e cadastro, e senha sozinha nao basta para isso).
   *
   * Ate 2026-08-20 este valor era FORCADO para true em producao,
   * independente do .env — desativar em produção exigia editar codigo,
   * de proposito, para nao virar um pedido casual ("desativa o 2FA um
   * pouco") atendido so trocando uma variavel. Removido a pedido
   * explicito do dono do projeto, ciente do que isso significa — ver
   * DECISOES.md. Reativar e so voltar esta variavel para `true` no
   * Railway; nenhum admin perde o cadastro de 2FA (totpSecret continua
   * gravado), a exigencia so volta a ser cobrada no proximo login.
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

  /**
   * WHATSAPP CLOUD API (META)
   *
   * INTERRUPTOR GERAL. Com false (o padrao), nenhuma chamada sai para a
   * Meta: o sistema registra no log o que enviaria e devolve sucesso
   * simulado, para o resto continuar funcionando. Ligar e so trocar esta
   * variavel — nenhuma linha de codigo muda. Ver WhatsAppService.
   */
  WHATSAPP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),

  /** Token PERMANENTE de System User. Segredo. */
  WHATSAPP_ACCESS_TOKEN: z.string().optional().or(z.literal('')),
  /** Id do numero DENTRO do WhatsApp Business, nao o telefone. */
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().or(z.literal('')),
  /** Id da WhatsApp Business Account. Usado para gestao de templates. */
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().or(z.literal('')),
  /**
   * Versao da Graph API. Configuravel porque a Meta descontinua versao
   * antiga com prazo: trocar aqui evita deploy de emergencia.
   */
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'Use o formato vXX.Y, como v23.0')
    .default('v23.0'),

  /**
   * Segredo combinado com a Meta no cadastro do webhook, devolvido no
   * desafio de verificacao. Escolhido por nos, nao gerado por eles.
   */
  WHATSAPP_VERIFY_TOKEN: z.string().optional().or(z.literal('')),
  /**
   * App Secret, usado para conferir a assinatura HMAC de cada webhook.
   * Sem ele o webhook RECUSA tudo — melhor recusar do que aceitar
   * evento que pode ter sido forjado.
   */
  WHATSAPP_APP_SECRET: z.string().optional().or(z.literal('')),

  /** Numero comercial, so para exibicao ao cliente. */
  WHATSAPP_PHONE_NUMBER: z.string().optional().or(z.literal('')),

  /**
   * NOTIFICACOES AUTOMATICAS DE PEDIDO (Evolution API)
   *
   * Modulo SEPARADO do WhatsApp Cloud API acima (ver
   * modules/whatsapp/README.md): aquele e a Meta oficial, planejada desde
   * o inicio do projeto mas ainda dependente de verificacao Meta Business;
   * este e a Evolution API (Baileys), ligada AGORA por decisao consciente
   * do dono para ter mensagem automatica funcionando ja, sabendo do risco
   * de banimento que Baileys carrega — ver DECISOES.md.
   *
   * `none` (padrao) desliga o disparo automatico inteiro: pedido continua
   * funcionando normalmente, nenhuma chamada sai. Nunca falha o boot por
   * falta de credencial quando desligado.
   */
  WHATSAPP_PROVIDER: z.enum(['none', 'evolution']).default('none'),

  /** Base da Evolution API, sem barra no final (ex.: https://minha-evolution.onrender.com). */
  EVOLUTION_API_URL: z
    .string()
    .url('EVOLUTION_API_URL deve ser uma URL completa')
    .or(z.literal(''))
    .default('')
    .transform((value) => value.replace(/\/+$/, '')),
  /** Chave enviada no header `apikey`. Segredo — nunca vai ao frontend. */
  EVOLUTION_API_KEY: z.string().optional().or(z.literal('')),
  /** Nome da instancia ja conectada ao WhatsApp Business (ex.: adventure-burguer). */
  EVOLUTION_INSTANCE: z.string().optional().or(z.literal('')),
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

  /**
   * Ligar o WhatsApp sem credencial nao pode passar em silencio.
   *
   * Sem esta checagem, errar o nome de uma variavel no Railway (facil:
   * existe WHATSAPP_PHONE_NUMBER e WHATSAPP_PHONE_NUMBER_ID) faria o
   * sistema subir normalmente e SIMULAR todos os envios — o dono so
   * descobriria quando um cliente reclamasse de nao ter recebido nada.
   * Falhar no boot e mais barato do que descobrir dias depois.
   */
  if (env.WHATSAPP_ENABLED) {
    const faltando = (
      [
        ['WHATSAPP_ACCESS_TOKEN', env.WHATSAPP_ACCESS_TOKEN],
        ['WHATSAPP_PHONE_NUMBER_ID', env.WHATSAPP_PHONE_NUMBER_ID],
      ] as const
    )
      .filter(([, valor]) => !valor)
      .map(([nome]) => nome);

    if (faltando.length > 0) {
      throw new Error(
        `WHATSAPP_ENABLED=true, mas falta: ${faltando.join(', ')}. ` +
          'Preencha as credenciais ou volte para WHATSAPP_ENABLED=false.',
      );
    }
  }

  /** Mesmo raciocinio, para o provedor de notificacoes automaticas. */
  if (env.WHATSAPP_PROVIDER === 'evolution') {
    const faltando = (
      [
        ['EVOLUTION_API_URL', env.EVOLUTION_API_URL],
        ['EVOLUTION_API_KEY', env.EVOLUTION_API_KEY],
        ['EVOLUTION_INSTANCE', env.EVOLUTION_INSTANCE],
      ] as const
    )
      .filter(([, valor]) => !valor)
      .map(([nome]) => nome);

    if (faltando.length > 0) {
      throw new Error(
        `WHATSAPP_PROVIDER=evolution, mas falta: ${faltando.join(', ')}. ` +
          'Preencha as credenciais ou volte para WHATSAPP_PROVIDER=none.',
      );
    }
  }

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
  }

  return env;
}
