import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { hasRoleLevel, AdminRole } from '@adventure/shared';
import { Button, Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { cx } from './lib/cx';
import { LoginPage } from './features/auth/LoginPage';
import { BalcaoPage } from './features/balcao/BalcaoPage';
import { CashbackPage } from './features/cashback/CashbackPage';
import { OrdersPage } from './features/orders/OrdersPage';
import { api } from './lib/api';
import { useAuth } from './lib/auth';

/**
 * O dashboard carrega sob demanda porque o Recharts responde por mais da
 * metade do peso do painel — e a cozinha, que fica com a tela de pedidos
 * aberta o dia inteiro, nunca abre o dashboard.
 */
const DashboardPage = lazy(() =>
  import('./features/dashboard/DashboardPage').then((m) => ({
    default: m.DashboardPage,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Portao />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Tenta restaurar a sessao pelo cookie httpOnly antes de decidir o que
 * mostrar. Sem isso, um F5 no painel jogaria o gestor de volta ao login
 * mesmo com sessao valida.
 */
function Portao() {
  const { accessToken, admin, ready, setReady, setSession } = useAuth();

  useEffect(() => {
    if (ready) return;

    void (async () => {
      const renovou = await api.refresh();
      if (renovou) {
        try {
          const perfil = await api.me();
          setSession(useAuth.getState().accessToken!, perfil);
        } catch {
          useAuth.getState().clear();
        }
      }
      setReady(true);
    })();
  }, [ready, setReady, setSession]);

  if (!ready) return <Spinner label="Verificando sessão" />;
  if (!accessToken || !admin) return <LoginPage />;

  return <Layout />;
}

function Layout() {
  const { admin, clear } = useAuth();
  const location = useLocation();

  /* A cozinha nao precisa ver faturamento — o menu esconde o que o papel
     nao acessa, e a API recusa de qualquer forma. */
  const podeVerRelatorios = admin ? hasRoleLevel(admin.role, AdminRole.MANAGER) : false;

  const sair = async () => {
    try {
      await api.logout();
    } finally {
      clear();
      queryClient.clear();
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-borda bg-preto/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-5 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt=""
              width={36}
              height={36}
              className="size-9 rounded-full border border-amarelo"
            />
            <span className="titulo-display hidden text-base sm:block">
              Painel <span className="text-amarelo">Adventure</span>
            </span>
          </div>

          <nav className="flex gap-1">
            <Aba para="/pedidos">Pedidos</Aba>
            <Aba para="/balcao">Balcão</Aba>
            {/* Cashback e informacao comercial (quanto a loja "deve" em
                saldo) e traz telefone de cliente — mesmo criterio do
                dashboard, so MANAGER para cima. */}
            {podeVerRelatorios && <Aba para="/cashback">Cashback</Aba>}
            {podeVerRelatorios && <Aba para="/dashboard">Dashboard</Aba>}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">{admin?.name}</p>
              <p className="text-xs text-cinza-2">{traduzirPapel(admin?.role)}</p>
            </div>
            <Button variant="contorno" size="sm" onClick={() => void sair()}>
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {/* key={pathname} remonta o boundary a cada troca de aba — sem
            isto, uma aba que quebrasse deixaria as OUTRAS abas (que nunca
            tiveram problema) presas na mesma tela de erro depois disso. */}
        <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/pedidos" element={<OrdersPage />} />
            <Route path="/balcao" element={<BalcaoPage />} />
            <Route
              path="/cashback"
              element={podeVerRelatorios ? <CashbackPage /> : <Navigate to="/pedidos" replace />}
            />
            <Route
              path="/dashboard"
              element={
                podeVerRelatorios ? (
                  <Suspense fallback={<Spinner label="Carregando gráficos" />}>
                    <DashboardPage />
                  </Suspense>
                ) : (
                  <Navigate to="/pedidos" replace />
                )
              }
            />
            <Route path="*" element={<Navigate to="/pedidos" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>

      <footer className="mx-auto max-w-7xl px-5 pb-6 text-center text-xs text-cinza-2/70">
        <span aria-hidden>🔒</span> Dados de clientes tratados conforme a{' '}
        <a
          href="https://loja.impactdev.site/privacidade"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-amarelo"
        >
          Política de Privacidade
        </a>{' '}
        — acesso restrito a quem tem função no atendimento do pedido.
      </footer>
    </div>
  );
}

function Aba({ para, children }: { para: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={para}
      className={({ isActive }) =>
        cx(
          'rounded-lg px-4 py-2 text-sm font-bold transition-colors',
          isActive ? 'bg-carvao text-white' : 'text-cinza hover:text-white',
        )
      }
    >
      {children}
    </NavLink>
  );
}

function traduzirPapel(papel?: string): string {
  const nomes: Record<string, string> = {
    OWNER: 'Proprietário',
    MANAGER: 'Gerente',
    KITCHEN: 'Cozinha',
    DELIVERY: 'Entrega',
  };
  return papel ? (nomes[papel] ?? papel) : '';
}
