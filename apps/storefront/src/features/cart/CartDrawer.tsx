import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { formatBRL, multiplyCents } from '@adventure/shared';
import { useCart } from '../../stores/cart';
import { resolveImageUrl } from '../../lib/imageUrl';
import { Button, EmptyState } from '../../components/ui';
import { cx } from '../../lib/cx';

export function CartDrawer() {
  const { items, isOpen, close, remove, setQuantity, clear, subtotalCents, unitTotalCents } =
    useCart();
  const navigate = useNavigate();

  /* Fechar com Esc e travar a rolagem do fundo enquanto o painel esta aberto. */
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, close]);

  const subtotal = subtotalCents();

  return (
    <>
      <div
        onClick={close}
        className={cx(
          'fixed inset-0 z-50 bg-preto/70 backdrop-blur-sm transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Carrinho"
        className={cx(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col',
          'border-l border-borda bg-preto-2 shadow-[-20px_0_60px_rgba(0,0,0,.6)]',
          'transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-center justify-between border-b border-borda px-5 py-4">
          <h2 className="titulo-display text-xl">Seu carrinho</h2>
          <button
            type="button"
            onClick={close}
            className="grid size-9 place-items-center rounded-full text-cinza transition-colors hover:bg-carvao hover:text-white"
            aria-label="Fechar carrinho"
          >
            ✕
          </button>
        </header>

        {items.length === 0 ? (
          <EmptyState
            icon="🛒"
            title="Carrinho vazio"
            description="Adicione itens do cardápio para começar seu pedido."
            action={
              <Button variant="contorno" onClick={close}>
                Ver cardápio
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ul className="space-y-3">
                {items.map((item) => (
                  <li
                    key={item.lineId}
                    className="flex gap-3 rounded-xl border border-borda bg-preto-3 p-3"
                  >
                    <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-carvao">
                      {item.imageUrl ? (
                        <img
                          src={resolveImageUrl(item.imageUrl)!}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="grid size-full place-items-center text-2xl">🍔</div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold">{item.name}</h3>
                        <button
                          type="button"
                          onClick={() => remove(item.lineId)}
                          className="text-cinza-2 transition-colors hover:text-vermelho-2"
                          aria-label={`Remover ${item.name}`}
                        >
                          ✕
                        </button>
                      </div>

                      <p className="text-xs text-cinza">
                        {formatBRL(unitTotalCents(item))} cada
                      </p>

                      {item.options.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {item.options.map((opcao) => (
                            <li key={opcao.id} className="text-xs text-amarelo">
                              + {opcao.quantity > 1 && `${opcao.quantity}× `}
                              {opcao.name}{' '}
                              <span className="text-cinza-2">
                                {formatBRL(multiplyCents(opcao.priceCents, opcao.quantity))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {item.notes && (
                        <p className="mt-1 text-xs text-cinza-2 italic">“{item.notes}”</p>
                      )}

                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1 rounded-full border border-borda">
                          <QtyButton
                            label={`Diminuir ${item.name}`}
                            onClick={() => setQuantity(item.lineId, item.quantity - 1)}
                          >
                            −
                          </QtyButton>
                          <span className="w-7 text-center text-sm font-bold">{item.quantity}</span>
                          <QtyButton
                            label={`Aumentar ${item.name}`}
                            onClick={() => setQuantity(item.lineId, item.quantity + 1)}
                          >
                            +
                          </QtyButton>
                        </div>

                        <span className="font-bold text-amarelo">
                          {formatBRL(multiplyCents(unitTotalCents(item), item.quantity))}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={clear}
                className="mt-4 w-full text-center text-xs text-cinza-2 underline transition-colors hover:text-vermelho-2"
              >
                Esvaziar carrinho
              </button>
            </div>

            <footer className="border-t border-borda p-5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-cinza">Subtotal</span>
                <span className="titulo-display text-2xl text-amarelo">{formatBRL(subtotal)}</span>
              </div>
              <p className="mb-4 text-xs text-cinza-2">
                A taxa de entrega e os descontos são calculados no próximo passo.
              </p>

              <Button
                full
                size="lg"
                onClick={() => {
                  close();
                  void navigate('/checkout');
                }}
              >
                Finalizar pedido
              </Button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

function QtyButton({
  children,
  onClick,
  label,
}: {
  children: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-7 place-items-center rounded-full text-sm font-bold text-cinza transition-colors hover:bg-carvao hover:text-white"
    >
      {children}
    </button>
  );
}
