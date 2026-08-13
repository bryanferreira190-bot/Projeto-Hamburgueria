/**
 * Cliente HTTP da API.
 *
 * Em desenvolvimento o Vite faz proxy de /api para localhost:3333, entao o
 * navegador ve tudo na mesma origem — igual a producao.
 */

const BASE = import.meta.env['VITE_API_URL'] ?? '/api/v1';

/** Erro de negocio vindo da API, no formato RFC 7807. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly fields?: { field: string; message: string }[],
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  /* O objeto e montado por partes porque exactOptionalPropertyTypes nao
     aceita `body: undefined` — a propriedade precisa simplesmente nao existir. */
  const init: RequestInit = {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    credentials: 'include',
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await fetch(`${BASE}${path}`, init);

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const problem = data as {
      detail?: string;
      title?: string;
      errors?: { field: string; message: string }[];
    };

    /* Erro de validacao traz a lista de campos; mostramos a primeira
       mensagem, que e a mais util para o cliente corrigir. */
    const detail =
      problem?.errors?.[0]?.message ??
      problem?.detail ??
      problem?.title ??
      'Nao foi possivel completar a operacao.';

    throw new ApiError(response.status, detail, problem?.errors);
  }

  return data as T;
}

/* ---------------- Tipos das respostas ---------------- */

export interface Option {
  id: string;
  name: string;
  priceCents: number;
  priceFormatted: string;
}

export interface OptionGroup {
  id: string;
  name: string;
  /** minSelect > 0 torna o grupo obrigatorio. */
  minSelect: number;
  maxSelect: number;
  options: Option[];
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  priceFormatted: string;
  isAvailable: boolean;
  isFeatured: boolean;
  /** Adicionais aceitos. Vazio quando o produto nao tem nenhum. */
  optionGroups: OptionGroup[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  position: number;
  products: Product[];
}

export interface StoreStatus {
  isOpen: boolean;
  reason: string;
  message: string;
  today: { weekday: number; opensAt: string | null; closesAt: string | null };
  schedule: { weekday: number; label: string; opensAt: string | null; closesAt: string | null }[];
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  minOrderCents: number;
  avgPrepMinutes: number;
}

export interface DeliveryQuote {
  available: boolean;
  zoneName: string | null;
  feeCents: number;
  feeFormatted: string;
  etaMinutes: number;
  minOrderCents: number;
  message: string;
}

export interface OrderItemResponse {
  productName: string;
  quantity: number;
  unitPriceFormatted: string;
  totalFormatted: string;
  notes: string | null;
  /** Ja agrupados com a quantidade pela API. */
  options: { name: string; priceCents: number; quantity: number }[];
}

export interface Order {
  id: string;
  number: string;
  type: 'DELIVERY' | 'PICKUP';
  status: string;
  createdAt: string;
  customer: { name: string | null; phone: string };
  items: OrderItemResponse[];
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  totalFormatted: string;
  paymentMethod: string;
  address: {
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    complement: string | null;
    reference: string | null;
  } | null;
  notes: string | null;
  cancelReason: string | null;
  timeline: { status: string; at: string; reason: string | null }[];
}

/* ---------------- Chamadas ---------------- */

export const api = {
  getMenu: () => request<Category[]>('/catalog/menu'),

  getStoreStatus: () => request<StoreStatus>('/store/status'),

  quoteDelivery: (district: string) =>
    request<DeliveryQuote>('/delivery/quote', { method: 'POST', body: { district } }),

  createOrder: (payload: unknown, idempotencyKey: string) =>
    request<Order>('/orders', {
      method: 'POST',
      body: payload,
      /* Impede que dois cliques em "Finalizar" virem dois pedidos. */
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  trackOrder: (number: string) => request<Order>(`/orders/track/${number}`),

  cancelOrder: (number: string, reason: string) =>
    request<Order>(`/orders/track/${number}/cancel`, { method: 'POST', body: { reason } }),
};
