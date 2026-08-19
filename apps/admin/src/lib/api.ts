import type { AdminRole, DashboardData, ResumoDeCashback } from '@adventure/shared';
import { useAuth, type AdminProfile } from './auth';

/**
 * Em desenvolvimento, "/api/v1" basta — o proxy do Vite (vite.config.ts)
 * repassa para localhost:3333, deixando front e API na mesma origem.
 *
 * Em producao, painel e API moram em subdominios diferentes
 * (painel.impactdev.site vs api.impactdev.site), entao precisa da URL
 * completa. VITE_API_URL e definida no build de producao (Cloudflare
 * Pages, por exemplo), nunca commitada.
 */
const BASE = import.meta.env['VITE_API_URL'] ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Rotas de autenticacao nao devem disparar a renovacao automatica. */
  skipRefresh?: boolean;
}

async function raw(path: string, options: Options = {}): Promise<Response> {
  const { method = 'GET', body } = options;
  const token = useAuth.getState().accessToken;

  const init: RequestInit = {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  return fetch(`${BASE}${path}`, init);
}

/**
 * Renovacao transparente.
 *
 * O access token dura 15 minutos. Em vez de derrubar o gestor no meio de um
 * relatorio, um 401 dispara uma renovacao pelo cookie e a chamada e repetida
 * uma unica vez. Falhando de novo, a sessao acabou de fato.
 */
async function request<T>(path: string, options: Options = {}): Promise<T> {
  let response = await raw(path, options);

  if (response.status === 401 && !options.skipRefresh) {
    const renewed = await tryRefresh();
    if (renewed) {
      response = await raw(path, options);
    } else {
      useAuth.getState().clear();
    }
  }

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const problem = data as { detail?: string; title?: string };
    throw new ApiError(
      response.status,
      problem?.detail ?? problem?.title ?? 'Não foi possível completar a operação.',
    );
  }

  return data as T;
}

/**
 * Como request(), mas para respostas que nao sao JSON — aqui, o CSV do
 * export. Mesma renovacao transparente de sessao no 401.
 *
 * Existe porque um `<a href={url} download>` apontando direto pra API
 * NUNCA funcionaria: o token de acesso vive so em memoria (de proposito,
 * por seguranca — nunca em localStorage), e uma navegacao de link simples
 * nao tem como anexar o header Authorization. Baixar precisa passar pelo
 * mesmo fetch autenticado que o resto do painel usa.
 */
async function requestBlob(path: string): Promise<Blob> {
  let response = await raw(path);

  if (response.status === 401) {
    const renewed = await tryRefresh();
    if (renewed) {
      response = await raw(path);
    } else {
      useAuth.getState().clear();
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, 'Não foi possível gerar o relatório.');
  }

  return response.blob();
}

async function tryRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/auth/admin/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return false;

    const data = (await response.json()) as { accessToken: string };
    useAuth.getState().setToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Tipos ---------------- */

export type LoginResponse =
  | { status: 'TOTP_REQUIRED'; challengeToken: string }
  | { status: 'TOTP_SETUP_REQUIRED'; setupToken: string }
  | {
      status: 'AUTHENTICATED';
      admin: AdminProfile;
      accessToken: string;
      expiresIn: number;
    };

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
  name: string;
  description: string | null;
  priceCents: number;
  priceFormatted: string;
  isAvailable: boolean;
  optionGroups: OptionGroup[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  products: Product[];
}

export interface OrderRow {
  id: string;
  number: string;
  type: 'DELIVERY' | 'PICKUP';
  status: string;
  createdAt: string;
  /** Lancado a mao no balcao, e nao recebido pelo site. */
  isManual: boolean;
  /**
   * NULO no pedido de balcao sem telefone — nao ha cliente cadastrado por
   * tras dele. Use `nomeDoCliente()` para exibir, que ja resolve isto
   * junto com manualCustomerName.
   */
  customer: { name: string | null; phone: string } | null;
  /** Nome dito no balcao por quem nao deixou telefone. */
  manualCustomerName: string | null;
  items: {
    productName: string;
    quantity: number;
    /** Adicionais escolhidos, ja agrupados com a quantidade pela API. */
    options: { name: string; priceCents: number; quantity: number }[];
    notes: string | null;
  }[];
  totalCents: number;
  totalFormatted: string;
  paymentMethod: string;
  /** So preenchido quando o pagamento e em dinheiro na entrega. */
  changeForCents: number | null;
  /**
   * Endereco completo — a API ja mandava tudo isto; so nao estava
   * declarado aqui. A ficha do cliente (ver DadosDoCliente) precisa do
   * complemento e da referencia para quem entrega achar a casa.
   */
  address: {
    zipCode: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    reference: string | null;
  } | null;
  notes: string | null;
}

/**
 * Nome que a cozinha ve e grita quando o pedido fica pronto.
 *
 * Um pedido de balcao sem telefone nao tem Customer nenhum, entao o nome
 * so existe em `manualCustomerName`; um pedido do site sempre tem
 * Customer. Concentrar essa escolha aqui evita a mesma cadeia de `??`
 * espalhada por cada tela que mostra pedido.
 */
export function nomeDoCliente(pedido: {
  customer: { name: string | null } | null;
  manualCustomerName: string | null;
}): string | null {
  return pedido.customer?.name ?? pedido.manualCustomerName ?? null;
}

export interface ManualOrderItem {
  productId: string;
  quantity: number;
  optionIds: string[];
  notes?: string;
}

export interface ManualOrderPayload {
  items: ManualOrderItem[];
  paymentMethod: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  changeForCents?: number;
}

/* ---------------- Chamadas ---------------- */

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/admin/login', {
      method: 'POST',
      body: { email, password },
      skipRefresh: true,
    }),

  loginTotp: (challengeToken: string, code: string) =>
    request<LoginResponse>('/auth/admin/login/totp', {
      method: 'POST',
      body: { challengeToken, code },
      skipRefresh: true,
    }),

  refresh: tryRefresh,

  logout: () => request<void>('/auth/admin/logout', { method: 'POST', skipRefresh: true }),

  me: () => request<AdminProfile & { totpEnabled: boolean; role: AdminRole }>('/auth/admin/me'),

  totpSetup: () =>
    request<{ secret: string; otpAuthUrl: string; qrCode: string }>('/auth/admin/totp/setup', {
      method: 'POST',
    }),

  totpEnable: (code: string) =>
    request<{ enabled: true }>('/auth/admin/totp/enable', {
      method: 'POST',
      body: { code },
    }),

  dashboard: (from?: Date, to?: Date) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());
    const query = params.toString();
    return request<DashboardData>(`/admin/reports/dashboard${query ? `?${query}` : ''}`);
  },

  orders: (params: {
    status?: string[];
    limit?: number;
    search?: string;
    /** ISO — filtro de data do Histórico. */
    from?: string;
    to?: string;
  }) => {
    const query = new URLSearchParams();
    params.status?.forEach((status) => query.append('status', status));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.search) query.set('search', params.search);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    return request<{ orders: OrderRow[]; nextCursor: string | null }>(`/orders?${query}`);
  },

  /* O cardapio e publico; a rota aceita a chamada autenticada do painel
     do mesmo jeito, entao nao ha endpoint proprio a manter. */
  menu: () => request<Category[]>('/catalog/menu'),

  cashback: () => request<ResumoDeCashback>('/admin/cashback'),

  createManualOrder: (payload: ManualOrderPayload) =>
    request<OrderRow>('/orders/manual', { method: 'POST', body: payload }),

  /** Nome ja associado a este telefone, se houver — ver BalcaoPage. */
  customerLookup: (phone: string) =>
    request<{ name: string | null } | null>(
      `/orders/customer-lookup?phone=${encodeURIComponent(phone)}`,
    ),

  updateOrderStatus: (id: string, status: string, reason?: string) =>
    request<OrderRow>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: { status, ...(reason ? { reason } : {}) },
    }),

  /**
   * Baixa o CSV via fetch autenticado e dispara "Salvar como" atraves de
   * um link temporario apontando pro Blob ja em memoria — nao pra URL da
   * API (essa nunca teria como carregar o header Authorization).
   */
  exportCsv: async (from?: Date, to?: Date): Promise<void> => {
    const params = new URLSearchParams();
    if (from) params.set('from', from.toISOString());
    if (to) params.set('to', to.toISOString());

    const blob = await requestBlob(`/admin/reports/export?${params}`);

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vendas.csv';
    link.click();
    URL.revokeObjectURL(url);
  },
};

/** Setup token e usado apenas nas rotas de configuracao do 2FA. */
export async function totpSetupWithToken(setupToken: string) {
  const response = await fetch(`${BASE}/auth/admin/totp/setup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${setupToken}` },
    credentials: 'include',
  });
  if (!response.ok) throw new ApiError(response.status, 'Não foi possível iniciar a configuração.');
  return (await response.json()) as {
    secret: string;
    otpAuthUrl: string;
    qrCode: string;
  };
}

export async function totpEnableWithToken(setupToken: string, code: string) {
  const response = await fetch(`${BASE}/auth/admin/totp/enable`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${setupToken}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    const data = (await response.json()) as { detail?: string };
    throw new ApiError(response.status, data?.detail ?? 'Código incorreto.');
  }
  return (await response.json()) as { enabled: true };
}
