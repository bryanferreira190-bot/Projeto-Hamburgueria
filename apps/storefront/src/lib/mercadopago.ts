import { loadMercadoPago } from '@mercadopago/sdk-js';

/**
 * SDK do Mercado Pago no navegador, com tipos.
 *
 * O pacote oficial (@mercadopago/sdk-js) so injeta o script e devolve
 * `unknown` — os tipos abaixo sao nossos, escritos a partir da
 * documentacao, para o resto do codigo nao trabalhar no escuro.
 *
 * POR QUE ISSO EXISTE: os dados do cartao (numero, CVV, validade) nunca
 * passam pelo nosso servidor. Os campos abaixo sao iframes do proprio
 * Mercado Pago; o que sai deles e um token de uso unico, e e so ele que
 * enviamos para a nossa API.
 */

export type TipoDeCampo = 'cardNumber' | 'expirationDate' | 'securityCode';

interface CampoSeguro {
  mount(idDoContainer: string): CampoSeguro;
  unmount(): CampoSeguro;
  on(evento: 'binChange', callback: (dados: { bin: string | null }) => void): CampoSeguro;
  on(evento: 'error', callback: (dados: { message: string }[]) => void): CampoSeguro;
  on(evento: 'validityChange', callback: (dados: { errorMessages: unknown[] }) => void): CampoSeguro;
}

interface MetodoDePagamento {
  id: string;
  payment_type_id: string;
}

interface OpcaoDeParcelamento {
  installments: number;
  recommended_message: string;
  total_amount: number;
}

interface InstanciaMercadoPago {
  fields: {
    create(tipo: TipoDeCampo, opcoes?: Record<string, unknown>): CampoSeguro;
    createCardToken(dados: {
      cardholderName: string;
      identificationType?: string;
      identificationNumber?: string;
    }): Promise<{ id: string }>;
  };
  getPaymentMethods(opcoes: { bin: string }): Promise<{ results: MetodoDePagamento[] }>;
  getInstallments(opcoes: {
    amount: string;
    bin: string;
    paymentTypeId: string;
  }): Promise<{ payer_costs: OpcaoDeParcelamento[] }[]>;
}

type ConstrutorMercadoPago = new (
  chavePublica: string,
  opcoes?: { locale?: string },
) => InstanciaMercadoPago;

const CHAVE_PUBLICA = import.meta.env['VITE_MERCADOPAGO_PUBLIC_KEY'] ?? '';

/** Sem chave configurada nao da para tokenizar — o checkout esconde a opcao. */
export const cartaoDisponivel = Boolean(CHAVE_PUBLICA);

let instancia: InstanciaMercadoPago | null = null;

/**
 * Carrega o SDK uma unica vez e devolve a instancia pronta.
 *
 * O carregamento e sob demanda (so quando o cliente escolhe cartao) para
 * nao pesar o carregamento de quem vai pagar com PIX ou na entrega.
 */
export async function obterMercadoPago(): Promise<InstanciaMercadoPago> {
  if (instancia) return instancia;
  if (!CHAVE_PUBLICA) throw new Error('Chave publica do Mercado Pago nao configurada');

  await loadMercadoPago();

  const Construtor = (window as unknown as { MercadoPago?: ConstrutorMercadoPago }).MercadoPago;
  if (!Construtor) throw new Error('SDK do Mercado Pago nao carregou');

  instancia = new Construtor(CHAVE_PUBLICA, { locale: 'pt-BR' });
  return instancia;
}

export type { CampoSeguro, InstanciaMercadoPago, OpcaoDeParcelamento };
