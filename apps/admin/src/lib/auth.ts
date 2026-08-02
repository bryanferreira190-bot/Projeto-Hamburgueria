import { create } from 'zustand';
import type { AdminRole } from '@adventure/shared';

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

interface AuthState {
  accessToken: string | null;
  admin: AdminProfile | null;
  /** Falso ate a primeira tentativa de renovar a sessao terminar. */
  ready: boolean;

  setSession: (token: string, admin: AdminProfile) => void;
  setToken: (token: string) => void;
  setReady: (ready: boolean) => void;
  clear: () => void;
}

/**
 * SESSAO EM MEMORIA
 *
 * O access token NAO e persistido — nem em localStorage, nem em cookie
 * legivel por JavaScript. Um XSS no painel nao consegue exfiltrar a sessao.
 *
 * A continuidade entre recarregamentos vem do refresh token, que vive em
 * cookie httpOnly e e trocado por um access token novo na inicializacao.
 */
export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  admin: null,
  ready: false,

  setSession: (accessToken, admin) => set({ accessToken, admin }),
  setToken: (accessToken) => set({ accessToken }),
  setReady: (ready) => set({ ready }),
  clear: () => set({ accessToken: null, admin: null }),
}));
