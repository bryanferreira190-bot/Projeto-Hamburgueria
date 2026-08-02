/**
 * Enums do dominio.
 *
 * Sao objetos `as const` em vez de `enum` do TypeScript porque:
 *  - geram valores string legiveis no banco e nos logs;
 *  - sao serializaveis em JSON sem conversao;
 *  - o Prisma e o Zod trabalham diretamente com eles.
 */

export const OrderStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  AWAITING_PICKUP: 'AWAITING_PICKUP',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderType = {
  DELIVERY: 'DELIVERY',
  PICKUP: 'PICKUP',
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export const PaymentMethod = {
  PIX: 'PIX',
  CREDIT_CARD: 'CREDIT_CARD',
  DEBIT_CARD: 'DEBIT_CARD',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
  CARD_ON_DELIVERY: 'CARD_ON_DELIVERY',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
  CANCELED: 'CANCELED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** Papeis administrativos, do menor para o maior privilegio. */
export const AdminRole = {
  DELIVERY: 'DELIVERY',
  KITCHEN: 'KITCHEN',
  MANAGER: 'MANAGER',
  OWNER: 'OWNER',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

/** Pagamentos liquidados online exigem confirmacao por webhook. */
export const ONLINE_PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.PIX,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.DEBIT_CARD,
];

export function isOnlinePayment(method: PaymentMethod): boolean {
  return ONLINE_PAYMENT_METHODS.includes(method);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Aguardando pagamento',
  CONFIRMED: 'Pedido confirmado',
  PREPARING: 'Em preparo',
  READY: 'Pronto',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  AWAITING_PICKUP: 'Aguardando retirada',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluido',
  CANCELED: 'Cancelado',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'PIX',
  CREDIT_CARD: 'Cartao de credito',
  DEBIT_CARD: 'Cartao de debito',
  CASH_ON_DELIVERY: 'Dinheiro na entrega',
  CARD_ON_DELIVERY: 'Maquininha na entrega',
};
