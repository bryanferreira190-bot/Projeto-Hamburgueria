import { create } from 'zustand';

export interface AdminLogado {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AdminAuthState {
  accessToken: string | null;
  admin: AdminLogado | null;
  /** Falso ate a primeira tentativa de retomar a sessao terminar. */
  verificado: boolean;

  entrar: (token: string, admin: AdminLogado) => void;
  trocarToken: (token: string) => void;
  marcarVerificado: () => void;
  sair: () => void;
}

/**
 * SESSAO DO ADMIN DENTRO DA LOJA
 *
 * O token de acesso fica SO em memoria — nunca em localStorage. Um XSS na
 * loja (que e a parte publica, exposta a qualquer visitante) nao consegue
 * roubar a sessao de quem administra o cardapio.
 *
 * A continuidade depois de um F5 vem do cookie httpOnly de refresh,
 * exatamente como no painel administrativo.
 */
export const useAdminAuth = create<AdminAuthState>((set) => ({
  accessToken: null,
  admin: null,
  verificado: false,

  entrar: (accessToken, admin) => set({ accessToken, admin }),
  trocarToken: (accessToken) => set({ accessToken }),
  marcarVerificado: () => set({ verificado: true }),
  sair: () => set({ accessToken: null, admin: null }),
}));
