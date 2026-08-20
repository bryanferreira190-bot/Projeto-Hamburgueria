/**
 * CONTRATO DE PROVEDOR DE WHATSAPP
 *
 * Nenhum ponto do sistema chama Evolution (ou Meta) diretamente — todos
 * passam por este contrato via MessagingService. Trocar de provedor no
 * futuro (Evolution -> Meta Cloud API, quando a verificacao terminar, ou
 * qualquer outro) significa escrever uma classe nova que implementa
 * isto, sem tocar em OrdersService, PaymentsService nem no fluxo de
 * pedido. Ver DECISOES.md sobre por que Evolution/Baileys foi escolhido
 * agora mesmo com esse risco.
 */

export interface ProviderSendResult {
  success: boolean;
  /** Id da mensagem no provedor, quando ele devolve um. */
  externalId?: string | null;
  /** Mensagem de erro legivel, nunca a causa crua (sem token/stack). */
  error?: string;
}

export interface ProviderHealth {
  connected: boolean;
  detail?: string;
}

export interface WhatsAppProvider {
  /** Nome curto para log e para o campo `provider` do NotificationLog. */
  readonly nome: string;

  /**
   * Texto ja pronto (placeholders ja substituidos) para um telefone ja
   * normalizado (formato internacional, so digitos). Quem implementa
   * cuida de timeout, retry e classificacao de erro — quem chama so
   * precisa saber se deu certo.
   */
  sendText(phone: string, message: string): Promise<ProviderSendResult>;

  /** Usado pelo health-check administrativo (GET /notifications/status). */
  checkHealth(): Promise<ProviderHealth>;
}
