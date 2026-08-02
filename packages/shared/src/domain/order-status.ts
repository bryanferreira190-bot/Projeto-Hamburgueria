import { OrderStatus, OrderType } from './enums.js';

/**
 * MAQUINA DE ESTADOS DO PEDIDO
 *
 * As transicoes validas ficam nesta tabela, e nao espalhadas em `if` pelo
 * codigo. Duas consequencias praticas:
 *  - a API e o painel usam exatamente a mesma regra;
 *  - adicionar um status novo e alterar um lugar so.
 *
 *   PENDING_PAYMENT -> CONFIRMED -> PREPARING -> READY -+-> OUT_FOR_DELIVERY -> DELIVERED
 *                                                       +-> AWAITING_PICKUP  -> COMPLETED
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: [OrderStatus.CONFIRMED, OrderStatus.CANCELED],
  CONFIRMED: [OrderStatus.PREPARING, OrderStatus.CANCELED],
  PREPARING: [OrderStatus.READY, OrderStatus.CANCELED],
  READY: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.AWAITING_PICKUP, OrderStatus.CANCELED],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.CANCELED],
  AWAITING_PICKUP: [OrderStatus.COMPLETED, OrderStatus.CANCELED],

  /* Estados finais: nada sai daqui. */
  DELIVERED: [],
  COMPLETED: [],
  CANCELED: [],
};

/** Status a partir dos quais o pedido nao muda mais. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELED,
];

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

/**
 * Apos READY o fluxo se divide conforme o tipo do pedido: entrega segue para
 * a rua, retirada aguarda o cliente no balcao.
 */
export function nextStatusFor(current: OrderStatus, type: OrderType): OrderStatus | null {
  if (current === OrderStatus.READY) {
    return type === OrderType.DELIVERY
      ? OrderStatus.OUT_FOR_DELIVERY
      : OrderStatus.AWAITING_PICKUP;
  }
  const candidates = TRANSITIONS[current].filter((s) => s !== OrderStatus.CANCELED);
  return candidates[0] ?? null;
}

/** O cliente so pode cancelar antes de a cozinha comecar a produzir. */
export function canCustomerCancel(status: OrderStatus): boolean {
  return status === OrderStatus.PENDING_PAYMENT || status === OrderStatus.CONFIRMED;
}

export class InvalidStatusTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`Transicao de status invalida: ${from} -> ${to}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

/** Valida a transicao e lanca erro tipado quando ela nao e permitida. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}
