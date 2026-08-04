import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useCart } from '../stores/cart';
import { Badge } from './ui';
import { cx } from '../lib/cx';

export function Header() {
  const totalItems = useCart((state) => state.totalItems());
  const openCart = useCart((state) => state.open);

  /* O status vem do servidor e revalida sozinho: a loja pode fechar
     enquanto o cliente monta o carrinho. */
  const { data: status } = useQuery({
    queryKey: ['store-status'],
    queryFn: api.getStoreStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <>
      <div className="bg-vermelho text-center text-[0.78rem] font-semibold tracking-wide">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-1.5">
          <span>🔥 Artesanal de verdade desde 2018</span>
          {status && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cx(
                  'size-2 rounded-full',
                  status.isOpen ? 'animate-pulse bg-verde' : 'bg-white/60',
                )}
                aria-hidden
              />
              {status.isOpen ? 'Aberto agora' : 'Fechado no momento'}
            </span>
          )}
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-white/8 bg-preto/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Adventure Burguer"
              width={44}
              height={44}
              className="size-11 rounded-full border-2 border-amarelo object-cover"
            />
            <span className="titulo-display hidden text-lg leading-none sm:block">
              Adventure
              <span className="block text-[0.86em] text-amarelo">Burguer</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/pedido"
              className="rounded-full px-3 py-2 text-sm font-semibold text-cinza transition-colors hover:text-white"
            >
              Meus pedidos
            </Link>

            <button
              type="button"
              onClick={openCart}
              className={cx(
                'relative inline-flex items-center gap-2 rounded-full px-5 py-2.5',
                'bg-gradient-to-br from-vermelho to-[#b8161c] text-sm font-bold text-white',
                'transition-transform hover:-translate-y-0.5',
              )}
              aria-label={`Abrir carrinho com ${totalItems} ${totalItems === 1 ? 'item' : 'itens'}`}
            >
              <span aria-hidden>🛒</span>
              <span className="hidden sm:inline">Carrinho</span>
              {totalItems > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-amarelo text-xs font-extrabold text-preto">
                  {totalItems}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {status && !status.isOpen && (
        <div className="border-b border-amarelo/25 bg-amarelo/10">
          <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-5 py-2.5 text-center text-sm">
            <Badge tone="alerta">Fechado</Badge>
            <span className="text-cinza">
              {status.message} Você pode montar o carrinho e finalizar quando abrirmos.
            </span>
          </div>
        </div>
      )}
    </>
  );
}
