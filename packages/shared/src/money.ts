/**
 * DINHEIRO EM CENTAVOS
 *
 * Todo valor monetario do sistema e um inteiro em centavos — nunca float.
 * Motivo: 0.1 + 0.2 === 0.30000000000000004 em ponto flutuante. Num pedido
 * com varios itens e adicionais, esse erro se acumula e o total cobrado
 * diverge do exibido. Inteiro em centavos elimina a classe inteira de bug.
 *
 * A conversao para reais acontece apenas na exibicao.
 */

/** Valor monetario inteiro, em centavos. Ex.: R$ 28,00 === 2800 */
export type Cents = number;

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Converte reais (ex.: 28.9) para centavos (2890). */
export function toCents(reais: number): Cents {
  return Math.round(reais * 100);
}

/** Converte centavos (2890) para reais (28.9). Use apenas para exibir. */
export function toReais(cents: Cents): number {
  return cents / 100;
}

/** Formata centavos como moeda brasileira: 2890 -> "R$ 28,90". */
export function formatBRL(cents: Cents): string {
  return BRL.format(cents / 100);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((total, value) => total + value, 0);
}

export function multiplyCents(cents: Cents, quantity: number): Cents {
  return Math.round(cents * quantity);
}

/**
 * Aplica desconto percentual arredondando para baixo, a favor da loja
 * em caso de fracao de centavo.
 */
export function applyPercentDiscount(cents: Cents, percent: number): Cents {
  if (percent <= 0) return cents;
  if (percent >= 100) return 0;
  return cents - Math.floor((cents * percent) / 100);
}

export function isValidCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
