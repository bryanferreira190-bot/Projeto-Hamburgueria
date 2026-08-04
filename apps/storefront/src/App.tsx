import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Header } from './components/Header';
import { Button, EmptyState, Spinner } from './components/ui';
import { CartDrawer } from './features/cart/CartDrawer';
import { MenuPage } from './features/catalog/MenuPage';
import { CheckoutPage } from './features/checkout/CheckoutPage';
import { TrackPage } from './features/order/TrackPage';

/**
 * A area de administracao carrega sob demanda: quem entra na loja para
 * pedir um lanche — que e a esmagadora maioria — nao baixa o codigo do
 * editor de cardapio junto.
 */
const AdminPage = lazy(() =>
  import('./features/admin/AdminPage').then((m) => ({ default: m.AdminPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex min-h-dvh flex-col">
          <Header />

          <main className="flex-1">
            <Routes>
              <Route path="/" element={<MenuPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/pedido" element={<TrackPage />} />
              <Route path="/pedido/:number" element={<TrackPage />} />
              <Route
                path="/admin"
                element={
                  <Suspense fallback={<Spinner label="Carregando" />}>
                    <AdminPage />
                  </Suspense>
                }
              />
              <Route
                path="*"
                element={
                  <EmptyState
                    icon="🍔"
                    title="Página não encontrada"
                    action={
                      <Link to="/">
                        <Button variant="contorno">Ir para o cardápio</Button>
                      </Link>
                    }
                  />
                }
              />
            </Routes>
          </main>

          <Footer />
        </div>

        <CartDrawer />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function Footer() {
  return (
    <footer className="border-t border-borda bg-preto-2 py-8">
      <div className="mx-auto max-w-6xl px-5 text-center text-sm text-cinza-2">
        <p className="titulo-display mb-1 text-base text-white">Adventure Burguer</p>
        <p>Hamburgueria artesanal desde 2018 · Itu/SP</p>
        <p className="mt-3">Feito com 🔥 e muito cheddar.</p>

        {/* Entrada discreta para quem administra: fica no rodape, sem
            destaque, e a rota so abre nada util sem login. O sigilo nao
            vem de esconder o link — vem da autenticacao na API. */}
        <Link
          to="/admin"
          className="mt-4 inline-block text-xs text-cinza-2/60 transition-colors hover:text-amarelo"
        >
          admin
        </Link>
      </div>
    </footer>
  );
}
