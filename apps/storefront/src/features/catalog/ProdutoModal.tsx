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

  /** id do adicional -> quantas unidades dele. Ausente = zero. */
  const [escolhidos, setEscolhidos] = useState<Record<string, number>>({});
  const [observacoes, setObservacoes] = useState('');
  const [quantidade, setQuantidade] = useState(1);

  /* Percorre os grupos em vez do objeto para manter a ordem do cardapio. */
  const adicionais: CartOption[] = produto.optionGroups.flatMap((grupo) =>
    grupo.options
      .filter((opcao) => (escolhidos[opcao.id] ?? 0) > 0)
      .map((opcao) => ({
        id: opcao.id,
        name: opcao.name,
        priceCents: opcao.priceCents,
        quantity: escolhidos[opcao.id]!,
      })),
  );

  const totalDeAdicionais = adicionais.reduce((soma, opcao) => soma + opcao.quantity, 0);
  const totalUnitario =
    produto.priceCents +
    adicionais.reduce((soma, opcao) => soma + opcao.priceCents * opcao.quantity, 0);

  /**
   * O teto vem do proprio grupo (maxSelect) e conta o total somado, nao
   * por tipo — a API recusa o pedido que passar disso, entao o botao "+"
   * trava antes de deixar montar algo que seria rejeitado no fim.
   */
  const tetoDoGrupo = produto.optionGroups[0]?.maxSelect ?? 0;
  const noTeto = totalDeAdicionais >= tetoDoGrupo;

  const mudarQuantidade = (id: string, delta: number) =>
    setEscolhidos((atual) => {
      const novo = Math.max(0, (atual[id] ?? 0) + delta);
      const proximo = { ...atual };
      if (novo === 0) delete proximo[id];
      else proximo[id] = novo;
      return proximo;
    });

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
                {noTeto ? `Máximo de ${tetoDoGrupo}` : grupo.minSelect > 0 ? 'Obrigatório' : 'Opcional'}
              </span>
            </div>

            <ul className="space-y-2">
              {grupo.options.map((opcao) => {
                const qtd = escolhidos[opcao.id] ?? 0;

                return (
                  <li
                    key={opcao.id}
                    className={cx(
                      'flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
                      qtd > 0 ? 'border-amarelo bg-amarelo/8' : 'border-borda bg-preto-3',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold uppercase">{opcao.name}</span>
                      <span className="text-sm font-bold text-amarelo">
                        +{opcao.priceFormatted}
                      </span>
                    </span>

                    <span className="flex shrink-0 items-center gap-1 rounded-full border border-borda">
                      <BotaoQtd
                        rotulo={`Tirar um ${opcao.name}`}
                        onClick={() => mudarQuantidade(opcao.id, -1)}
                        desabilitado={qtd === 0}
                      >
                        −
                      </BotaoQtd>
                      <span
                        className={cx(
                          'w-6 text-center text-sm font-bold',
                          qtd > 0 ? 'text-amarelo' : 'text-cinza-2',
                        )}
                      >
                        {qtd}
                      </span>
                      <BotaoQtd
                        rotulo={`Adicionar um ${opcao.name}`}
                        onClick={() => mudarQuantidade(opcao.id, 1)}
                        desabilitado={noTeto}
                      >
                        +
                      </BotaoQtd>
                    </span>
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
  desabilitado,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  desabilitado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      disabled={desabilitado}
      className={cx(
        'grid size-8 place-items-center rounded-full text-lg transition-colors',
        desabilitado
          ? 'cursor-not-allowed text-cinza-2/40'
          : 'text-cinza hover:bg-carvao hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
