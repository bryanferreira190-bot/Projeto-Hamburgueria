/**
 * Tipos da WhatsApp Cloud API (Meta).
 *
 * Modelam so o que este projeto usa — a API tem muito mais coisa
 * (interativo, lista, botao, midia). Tipar o que nao se usa vira codigo
 * morto que ninguem valida contra a realidade.
 *
 * Referencia: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

/* ============================================================
   ENVIO
   ============================================================ */

/** Corpo de uma mensagem de texto simples. */
export interface PayloadDeTexto {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url: boolean };
}

/**
 * Um parametro que preenche {{1}}, {{2}}... do template.
 *
 * A Meta so aceita variaveis POSICIONAIS no corpo: a ordem do array e o
 * que define qual {{n}} recebe cada valor. Nao existe "nome" de
 * variavel.
 */
export interface ParametroDeTemplate {
  type: 'text';
  text: string;
}

export interface PayloadDeTemplate {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components: { type: 'body'; parameters: ParametroDeTemplate[] }[];
  };
}

export type PayloadDeMensagem = PayloadDeTexto | PayloadDeTemplate;

/** Resposta de sucesso da Cloud API ao enviar. */
export interface RespostaDeEnvio {
  messaging_product: 'whatsapp';
  contacts?: { input: string; wa_id: string }[];
  messages?: { id: string; message_status?: string }[];
}

/**
 * Resultado de uma tentativa de envio, ja normalizado.
 *
 * `simulado` distingue "a Meta aceitou" de "o envio esta desligado e so
 * foi registrado no log". Quem chama precisa poder diferenciar: marcar
 * um aviso como enviado quando nada saiu seria mentir para o proprio
 * sistema (ver o job de cashback).
 */
export interface ResultadoDeEnvio {
  enviado: boolean;
  simulado: boolean;
  /** Id da mensagem na Meta. Null quando simulado ou quando falhou. */
  messageId: string | null;
  /** Preenchido so quando `enviado` e false. */
  erro?: {
    tipo: TipoDeErroWhatsApp;
    mensagem: string;
    /** Codigo numerico da Meta, quando veio. */
    codigo?: number;
  };
}

/* ============================================================
   ERROS
   ============================================================ */

export type TipoDeErroWhatsApp =
  /** Token invalido, expirado ou sem permissao. Nao adianta repetir. */
  | 'CREDENCIAL_INVALIDA'
  /**
   * Problema na configuracao da NOSSA conta: numero da loja nao
   * registrado, faturamento pendente, conta bloqueada. Separado de
   * DESTINATARIO_INVALIDO de proposito — confundir os dois faz procurar
   * defeito no telefone do cliente quando o problema e do nosso lado.
   */
  | 'CONFIGURACAO_INVALIDA'
  /** Numero do cliente nao recebe no WhatsApp. Nao repetir. */
  | 'DESTINATARIO_INVALIDO'
  /** Template inexistente, nao aprovado, ou variaveis nao batem. Nao repetir. */
  | 'TEMPLATE_INVALIDO'
  /** Fora da janela de 24h e sem template. Nao repetir. */
  | 'FORA_DA_JANELA'
  /** A Meta decidiu nao entregar (qualidade/engajamento). Nao repetir. */
  | 'RECUSADO_PELA_META'
  /** Limite de envio da conta atingido — janela de horas, nao de segundos. */
  | 'LIMITE_EXCEDIDO'
  /** Timeout ou falha de rede. Vale repetir. */
  | 'INDISPONIVEL'
  /** Qualquer outra coisa que a Meta devolveu. */
  | 'ERRO_DA_META';

/** Formato de erro da Graph API. */
export interface ErroDaMeta {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { messaging_product?: string; details?: string };
    fbtrace_id?: string;
  };
}

/* ============================================================
   WEBHOOK
   ============================================================ */

export type StatusDeMensagem = 'sent' | 'delivered' | 'read' | 'failed';

export interface StatusRecebido {
  id: string;
  status: StatusDeMensagem;
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title: string; message?: string }[];
}

export interface MensagemRecebida {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

export interface ValorDoWebhook {
  messaging_product?: 'whatsapp';
  metadata?: { display_phone_number: string; phone_number_id: string };
  contacts?: { profile: { name: string }; wa_id: string }[];
  messages?: MensagemRecebida[];
  statuses?: StatusRecebido[];
}

export interface CorpoDoWebhook {
  object?: string;
  entry?: { id: string; changes?: { value: ValorDoWebhook; field: string }[] }[];
}
