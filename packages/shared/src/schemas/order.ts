import { z } from 'zod';
import { OrderStatus, OrderType, PaymentMethod, isCardPayment } from '../domain/enums.js';
import { centsSchema, emailSchema, uuidSchema } from './common.js';
import { addressSchema } from './customer.js';
import { phoneSchema } from './common.js';

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

/** Identificacao minima para contato e entrega. */
export const orderCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  phone: phoneSchema,
  /* O checkout nao pede mais e-mail do cliente. Campo continua aceito e
     opcional so por compatibilidade (ex.: pedido antigo, integracao
     futura) — nunca exigido. Quando o pagamento e online (PIX/cartao) e
     o cliente nao informou, o servidor gera um e-mail de contingencia
     so para o Mercado Pago (ver OrdersService.create). */
  email: emailSchema.optional(),
});
export type OrderCustomerInput = z.infer<typeof orderCustomerSchema>;

/**
 * DADOS DO CARTAO — SO O QUE PODE TRAFEGAR
 *
 * Numero, CVV e validade NUNCA passam por aqui nem tocam o nosso
 * servidor: o navegador os envia direto ao Mercado Pago, que devolve um
 * token de uso unico. E esse token que chega na API. Assim o sistema
 * fica fora do escopo mais pesado de PCI-DSS, e um vazamento nosso nao
 * expoe cartao de ninguem.
 */
export const cardPaymentSchema = z.object({
  /** Token de uso unico gerado pelo SDK do Mercado Pago no navegador. */
  token: z.string().trim().min(1, 'Token do cartao ausente'),
  /** Bandeira detectada pelo proprio SDK (ex.: "master", "visa", "elo"). */
  paymentMethodId: z.string().trim().min(1, 'Bandeira do cartao ausente'),
  installments: z
    .number()
    .int()
    .min(1, 'Parcelamento invalido')
    .max(12, 'Parcelamento acima do limite'),
});
export type CardPaymentInput = z.infer<typeof cardPaymentSchema>;

const baseOrderSchema = z.object({
  customer: orderCustomerSchema,
  items: z.array(orderItemInputSchema).min(1, 'Adicione ao menos um item'),
  paymentMethod: z.nativeEnum(PaymentMethod),
  couponCode: z.string().trim().toUpperCase().max(40).optional(),
  notes: z.string().trim().max(300).optional(),
  /* Quanto o cliente vai pagar em dinheiro, para o entregador levar troco. */
  changeForCents: centsSchema.optional(),
  /**
   * Quanto do proprio saldo de cashback o cliente quer abater.
   *
   * E so um PEDIDO: o servidor recalcula o saldo real e o teto da loja
   * e usa o menor valor. Confiar neste numero deixaria qualquer um
   * zerar o proprio pedido mandando um valor alto pelo DevTools.
   */
  cashbackToUseCents: centsSchema.optional(),
  /* Exigido quando o pagamento e por cartao — ver o refine mais abaixo. */
  card: cardPaymentSchema.optional(),
});

/**
 * Entrega exige endereco; retirada nao. A uniao discriminada garante isso no
 * tipo, entao o TypeScript acusa o erro antes de chegar em runtime.
 */
export const createOrderSchema = z
  .discriminatedUnion('type', [
    baseOrderSchema.extend({
      type: z.literal(OrderType.DELIVERY),
      address: addressSchema,
    }),
    baseOrderSchema.extend({
      type: z.literal(OrderType.PICKUP),
    }),
  ])
  .refine(
    (order) =>
      order.paymentMethod !== PaymentMethod.CASH_ON_DELIVERY || order.changeForCents !== undefined,
    { message: 'Informe para quanto precisa de troco', path: ['changeForCents'] },
  )
  .refine((order) => !isCardPayment(order.paymentMethod) || order.card !== undefined, {
    message: 'Preencha os dados do cartao',
    path: ['card'],
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * PEDIDO LANCADO NO BALCAO PELA COZINHA
 *
 * Nao e o mesmo formulario do site com outro nome — as regras sao outras,
 * porque a venda ja esta acontecendo na frente do atendente:
 *
 * - cliente e OPCIONAL. Quem compra no balcao nem sempre quer dar nome, e
 *   quase nunca da telefone. Exigir faria a cozinha inventar dado.
 * - pagamento sai da lista de balcao (dinheiro / maquininha / PIX no QR
 *   da loja). Nada disso passa pelo Mercado Pago: o dinheiro entra ali na
 *   hora, e o campo so registra COMO entrou, para o fechamento do caixa.
 * - nao ha endereco, taxa nem cupom: e retirada no balcao.
 */
export const MANUAL_PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH_ON_DELIVERY,
  PaymentMethod.CARD_ON_DELIVERY,
  PaymentMethod.PIX,
];

export const createManualOrderSchema = z
  .object({
    items: z.array(orderItemInputSchema).min(1, 'Adicione ao menos um item'),
    paymentMethod: z
      .nativeEnum(PaymentMethod)
      .refine((metodo) => MANUAL_PAYMENT_METHODS.includes(metodo), {
        message: 'Forma de pagamento invalida para pedido no balcao',
      }),
    /* So para chamar o cliente quando ficar pronto. */
    customerName: z.string().trim().min(2, 'Nome muito curto').max(120).optional(),
    customerPhone: phoneSchema.optional(),
    notes: z.string().trim().max(300).optional(),
    changeForCents: centsSchema.optional(),
  })
  .refine(
    (pedido) =>
      pedido.paymentMethod !== PaymentMethod.CASH_ON_DELIVERY ||
      pedido.changeForCents === undefined ||
      pedido.changeForCents > 0,
    { message: 'Informe um valor valido para o troco', path: ['changeForCents'] },
  );
export type CreateManualOrderInput = z.infer<typeof createManualOrderSchema>;

/**
 * Consulta se um telefone ja tem cliente cadastrado, antes de lancar o
 * pedido do balcao.
 *
 * O cadastro e por telefone (ver customer.upsert em OrdersService): dois
 * nomes diferentes com o MESMO telefone viram o MESMO cliente, e o nome
 * mais recente sobrescreve o anterior silenciosamente. Sem avisar quem
 * esta atendendo, um numero digitado errado (ou reaproveitado por habito)
 * mistura o historico de duas pessoas diferentes sem ninguem perceber.
 */
export const customerLookupQuerySchema = z.object({
  phone: phoneSchema,
});
export type CustomerLookupQuery = z.infer<typeof customerLookupQuerySchema>;

/** null = telefone ainda sem cadastro. */
export interface CustomerLookup {
  name: string | null;
}

export const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  reason: z.string().trim().max(200).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/**
 * Confirmacao de identidade para acessar um pedido pelo numero curto.
 *
 * O numero ("A001") e curto, sequencial por dia e portanto trivialmente
 * enumeravel — sem isto, bastaria percorrer A001, A002... para ler nome,
 * telefone e endereco de qualquer cliente da loja. O telefone informado
 * no proprio checkout serve de segundo fator simples: so quem fez o
 * pedido (ou recebeu o link) sabe qual numero usar.
 */
export const trackOrderQuerySchema = z.object({
  phone: phoneSchema,
});
export type TrackOrderQuery = z.infer<typeof trackOrderQuerySchema>;

export const cancelOrderSchema = z.object({
  phone: phoneSchema,
  reason: z.string().trim().min(3, 'Informe o motivo').max(200),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const listOrdersFilterSchema = z.object({
  status: z
    .union([z.nativeEnum(OrderStatus), z.array(z.nativeEnum(OrderStatus))])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    ),
  type: z.nativeEnum(OrderType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(80).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListOrdersFilter = z.infer<typeof listOrdersFilterSchema>;

/** Consulta de taxa de entrega antes de fechar o pedido. */
export const deliveryQuoteSchema = z.object({
  district: z.string().trim().min(2, 'Informe o bairro').max(120),
});
export type DeliveryQuoteInput = z.infer<typeof deliveryQuoteSchema>;
