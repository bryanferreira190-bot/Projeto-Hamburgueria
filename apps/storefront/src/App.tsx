import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Header } from './components/Header';
import { Button, EmptyState } from './components/ui';
import { CartDrawer } from './features/cart/CartDrawer';
import { MenuPage } from './features/catalog/MenuPage';
import { CheckoutPage } from './features/checkout/CheckoutPage';
import { TrackPage } from './features/order/TrackPage';

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
      </div>
    </footer>
  );
}
