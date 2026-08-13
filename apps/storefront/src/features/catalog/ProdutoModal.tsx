import { useState } from 'react';
import { formatBRL } from '@adventure/shared';
import type { Product } from '../../lib/api';
import { resolveImageUrl } from '../../lib/imageUrl';
import { useCart, type CartOption } from '../../stores/cart';
import { Button, Modal, Textarea } from '../../components/ui';
import { cx } from '../../lib/cx';

/**
 * Escolha dos adicionais antes de mandar para o carrinho.
 *
 * Os precos exibidos aqui vem do cardapio, mas quem manda e o servidor:
 * no fechamento do pedido ele recalcula tudo a partir do banco. Mexer
 * nesses numeros pelo DevTools nao muda o que sera cobrado.
 */
export function ProdutoModal({ produto, aoFechar }: { produto: Product; aoFechar: () => void }) {
  const add = useCart((state) => state.add);
  const openCart = useCart((state) => state.open);

  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [observacoes, setObservacoes] = useState('');
  const [quantidade, setQuantidade] = useState(1);

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  /* Percorre os grupos em vez do Set para manter a ordem do cardapio. */
  const adicionais: CartOption[] = produto.optionGroups.flatMap((grupo) =>
    grupo.options
      .filter((opcao) => escolhidos.has(opcao.id))
      .map((opcao) => ({ id: opcao.id, name: opcao.name, priceCents: opcao.priceCents })),
  );

  const totalUnitario =
    produto.priceCents + adicionais.reduce((soma, opcao) => soma + opcao.priceCents, 0);

  const confirmar = () => {
    add(produto, {
      quantity: quantidade,
      options: adicionais,
      ...(observacoes.trim() ? { notes: observacoes.trim() } : {}),
    });
    aoFechar();
    openCart();
  };

  const foto = resolveImageUrl(produto.imageUrl);

  return (
    <Modal titulo={produto.name} aoFechar={aoFechar}>
      <div className="space-y-5">
        <div className="flex gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-carvao">
            {foto ? (
              <img src={foto} alt="" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-3xl">🍔</div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {produto.description && (
              <p className="text-sm leading-relaxed text-cinza">{produto.description}</p>
            )}
            <p className="mt-1.5 titulo-display text-lg text-amarelo">{produto.priceFormatted}</p>
          </div>
        </div>

        {produto.optionGroups.map((grupo) => (
          <div key={grupo.id}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-bold tracking-wide uppercase">{grupo.name}</h3>
              <span className="text-xs text-cinza-2">
                {grupo.minSelect > 0 ? 'Obrigatório' : 'Opcional'}
              </span>
            </div>

            <ul className="space-y-2">
              {grupo.options.map((opcao) => {
                const marcado = escolhidos.has(opcao.id);

                return (
                  <li key={opcao.id}>
                    <label
                      className={cx(
                        'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                        marcado
                          ? 'border-amarelo bg-amarelo/8'
                          : 'border-borda bg-preto-3 hover:border-cinza-2',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternar(opcao.id)}
                        className="size-4 accent-[#ffc21a]"
                      />
                      <span className="flex-1 text-sm font-semibold uppercase">{opcao.name}</span>
                      <span className="text-sm font-bold text-amarelo">
                        +{opcao.priceFormatted}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div>
          <label className="mb-1.5 block text-sm font-semibold">
            Observações
            <span className="ml-1 text-xs font-normal text-cinza-2">
              (o que tirar do lanche, ponto da carne…)
            </span>
          </label>
          <Textarea
            value={observacoes}
            onChange={(evento) => setObservacoes(evento.target.value)}
            rows={3}
            maxLength={200}
            placeholder="Ex.: sem cebola, sem picles, capricha na maionese"
          />
          <span className="mt-1 block text-right text-xs text-cinza-2">
            {observacoes.length}/200
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-borda pt-4">
          <div className="flex items-center gap-1 rounded-full border border-borda">
            <BotaoQtd
              rotulo="Diminuir quantidade"
              onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
            >
              −
            </BotaoQtd>
            <span className="w-8 text-center font-bold">{quantidade}</span>
            <BotaoQtd
              rotulo="Aumentar quantidade"
              onClick={() => setQuantidade((q) => Math.min(50, q + 1))}
            >
              +
            </BotaoQtd>
          </div>

          <Button onClick={confirmar} className="flex-1">
            Adicionar · {formatBRL(totalUnitario * quantidade)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function BotaoQtd({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full text-lg text-cinza transition-colors hover:bg-carvao hover:text-white"
    >
      {children}
    </button>
  );
}
