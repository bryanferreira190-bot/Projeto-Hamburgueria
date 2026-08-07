import { ApiError, type Category } from './api';
import { useAdminAuth, type AdminLogado } from './adminAuth';

const BASE = import.meta.env['VITE_API_URL'] ?? '/api/v1';

/**
 * Chamadas autenticadas do administrador.
 *
 * Separado de api.ts de proposito: aquele arquivo e o cliente publico,
 * usado por qualquer visitante, e nao deve carregar nada relacionado a
 * sessao administrativa.
 */

interface Opcoes {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** FormData nao pode levar Content-Type manual — o navegador define o boundary. */
  formData?: FormData;
  semRenovar?: boolean;
}

async function chamar(path: string, opcoes: Opcoes = {}): Promise<Response> {
  const { method = 'GET', body, formData } = opcoes;
  const token = useAdminAuth.getState().accessToken;

  const init: RequestInit = {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  };

  if (formData) init.body = formData;
  else if (body !== undefined) init.body = JSON.stringify(body);

  return fetch(`${BASE}${path}`, init);
}

/**
 * O token de acesso vale 15 minutos. Em vez de expulsar quem esta no meio
 * de uma edicao, um 401 dispara uma renovacao pelo cookie e repete a
 * chamada uma unica vez.
 */
async function requisitar<T>(path: string, opcoes: Opcoes = {}): Promise<T> {
  let resposta = await chamar(path, opcoes);

  if (resposta.status === 401 && !opcoes.semRenovar) {
    const renovou = await renovarSessao();
    if (renovou) resposta = await chamar(path, opcoes);
    else useAdminAuth.getState().sair();
  }

  const texto = await resposta.text();
  const dados: unknown = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    const problema = dados as {
      detail?: string;
      title?: string;
      errors?: { field: string; message: string }[];
    };
    throw new ApiError(
      resposta.status,
      problema?.errors?.[0]?.message ??
        problema?.detail ??
        problema?.title ??
        'Não foi possível completar a operação.',
      problema?.errors,
    );
  }

  return dados as T;
}

async function renovarSessao(): Promise<boolean> {
  try {
    const resposta = await fetch(`${BASE}/auth/admin/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!resposta.ok) return false;

    const dados = (await resposta.json()) as { accessToken: string };
    useAdminAuth.getState().trocarToken(dados.accessToken);
    return true;
  } catch {
    return false;
  }
}

export type RespostaLogin =
  | { status: 'TOTP_REQUIRED'; challengeToken: string }
  | { status: 'TOTP_SETUP_REQUIRED'; setupToken: string }
  | { status: 'AUTHENTICATED'; admin: AdminLogado; accessToken: string; expiresIn: number };

export interface RegrasDaFoto {
  recommendedWidth: number;
  recommendedHeight: number;
  maxBytes: number;
  acceptedMimeTypes: string[];
}

export interface ProdutoEditavel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  priceFormatted: string;
  isAvailable: boolean;
}

export const adminApi = {
  login: (email: string, password: string) =>
    requisitar<RespostaLogin>('/auth/admin/login', {
      method: 'POST',
      body: { email, password },
      semRenovar: true,
    }),

  loginTotp: (challengeToken: string, code: string) =>
    requisitar<RespostaLogin>('/auth/admin/login/totp', {
      method: 'POST',
      body: { challengeToken, code },
      semRenovar: true,
    }),

  renovarSessao,

  perfil: () => requisitar<AdminLogado>('/auth/admin/me'),

  sair: () => requisitar<void>('/auth/admin/logout', { method: 'POST', semRenovar: true }),

  /** Cardapio completo, incluindo itens marcados como indisponiveis. */
  produtos: () => requisitar<Category[]>('/admin/products'),

  regrasDaFoto: () => requisitar<RegrasDaFoto>('/admin/products/image-rules'),

  salvarProduto: (
    id: string,
    dados: { name?: string; description?: string; priceCents?: number; isAvailable?: boolean },
  ) => requisitar<ProdutoEditavel>(`/admin/products/${id}`, { method: 'PATCH', body: dados }),

  enviarFoto: (id: string, arquivo: File) => {
    const formData = new FormData();
    formData.append('file', arquivo);
    return requisitar<{ imageUrl: string }>(`/admin/products/${id}/image`, {
      method: 'POST',
      formData,
    });
  },

  removerFoto: (id: string) =>
    requisitar<{ imageUrl: null }>(`/admin/products/${id}/image`, { method: 'DELETE' }),
};
