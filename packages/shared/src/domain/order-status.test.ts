import { describe, expect, it } from 'vitest';
import { OrderStatus, OrderType } from './enums.js';
import {
  InvalidStatusTransitionError,
  assertTransition,
  canCustomerCancel,
  canTransition,
  isTerminalStatus,
  nextStatusFor,
} from './order-status.js';

describe('maquina de estados do pedido', () => {
  it('permite o caminho feliz da entrega', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED)).toBe(true);
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.PREPARING)).toBe(true);
    expect(canTransition(OrderStatus.PREPARING, OrderStatus.READY)).toBe(true);
    expect(canTransition(OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY)).toBe(true);
    expect(canTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED)).toBe(true);
  });

  it('bloqueia pular etapas', () => {
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.DELIVERED)).toBe(false);
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.READY)).toBe(false);
  });

  it('nao deixa pedido finalizado voltar atras', () => {
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.PREPARING)).toBe(false);
    expect(canTransition(OrderStatus.CANCELED, OrderStatus.CONFIRMED)).toBe(false);
    expect(isTerminalStatus(OrderStatus.DELIVERED)).toBe(true);
  });

  it('separa entrega de retirada apos READY', () => {
    expect(nextStatusFor(OrderStatus.READY, OrderType.DELIVERY)).toBe(OrderStatus.OUT_FOR_DELIVERY);
    expect(nextStatusFor(OrderStatus.READY, OrderType.PICKUP)).toBe(OrderStatus.AWAITING_PICKUP);
  });

  it('so deixa o cliente cancelar antes do preparo', () => {
    expect(canCustomerCancel(OrderStatus.CONFIRMED)).toBe(true);
    expect(canCustomerCancel(OrderStatus.PREPARING)).toBe(false);
    expect(canCustomerCancel(OrderStatus.OUT_FOR_DELIVERY)).toBe(false);
  });

  it('lanca erro tipado em transicao invalida', () => {
    expect(() => assertTransition(OrderStatus.DELIVERED, OrderStatus.PREPARING)).toThrow(
      InvalidStatusTransitionError,
    );
  });
});
