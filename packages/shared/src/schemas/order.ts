import { z } from 'zod';
import { OrderStatus, OrderType, PaymentMethod } from '../domain/enums.js';
import { centsSchema, uuidSchema } from './common.js';

/**
 * SCHEMA DE CRIACAO DE PEDIDO
 *
 * Observe que o cliente NAO envia precos. Ele informa apenas o que quer
 * (produto, quantidade, adicionais) e o servidor calcula todos os valores
 * consultando o banco.
 *
 * Aceitar preco vindo do navegador e a origem da fraude mais comum em
 * e-commerce: basta abrir o DevTools e mudar o total para 1 centavo.
 */

export const orderItemInputSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(1, 'Quantidade minima e 1').max(50, 'Quantidade acima do limite'),
  /* Adicionais escolhidos; o preco de cada um vem do banco. */
  optionIds: z.array(uuidSchema).max(30).default([]),
  notes: z.string().trim().max(200).optional(),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

const baseOrderSchema = z.object({
  items: z.array(orderItemInputSchema).min(1, 'Adicione ao menos um item'),
  paymentMethod: z.nativeEnum(PaymentMethod),
  couponCode: z.string().trim().toUpperCase().max(40).optional(),
  notes: z.string().trim().max(300).optional(),
  /* Quanto o cliente vai pagar em dinheiro, para o entregador levar troco. */
  changeFor: centsSchema.optional(),
});

/**
 * Entrega exige endereco; retirada nao. A uniao discriminada garante isso no
 * tipo, entao o TypeScript acusa o erro antes de chegar em runtime.
 */
export const createOrderSchema = z
  .discriminatedUnion('type', [
    baseOrderSchema.extend({
      type: z.literal(OrderType.DELIVERY),
      addressId: uuidSchema,
    }),
    baseOrderSchema.extend({
      type: z.literal(OrderType.PICKUP),
    }),
  ])
  .refine(
    (order) => order.paymentMethod !== PaymentMethod.CASH_ON_DELIVERY || order.changeFor !== undefined,
    { message: 'Informe para quanto precisa de troco', path: ['changeFor'] },
  );
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  reason: z.string().trim().max(200).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo').max(200),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const listOrdersFilterSchema = z.object({
  status: z.array(z.nativeEnum(OrderStatus)).optional(),
  type: z.nativeEnum(OrderType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(80).optional(),
});
export type ListOrdersFilter = z.infer<typeof listOrdersFilterSchema>;
