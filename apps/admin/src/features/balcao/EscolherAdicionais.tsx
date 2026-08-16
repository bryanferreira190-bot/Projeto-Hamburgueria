import { useEffect, useMemo, useState } from 'react';
import { formatBRL } from '@adventure/shared';
import type { Option, Product } from '../../lib/api';
import { Button, Input } from '../../components/ui';
import { cx } from '../../lib/cx';

type Escolhido = { id: string; name: string; priceCents: number };

/**
 * Escolha de adicionais antes de mandar o item para a comanda.
 *
 * Respeita minSelect/maxSelect de cada grupo — as mesmas regras que a API
 * aplica ao precificar. Barrar aqui evita a cozinha montar o pedido
 * inteiro para so depois levar um erro do servidor, com o cliente parado
 * na frente dela esperando.
 */
export function EscolherAdicionais({
  produto,
  onConfirmar,
  onFechar,
}: {
  produto: Product;
  onConfirmar: (adicionais: Escolhido[], observacao: string) => void;
  onFechar: () => void;
}) {
  /* Quantidade por opcao: o mesmo adicional pode entrar mais de uma vez
     ("2x bacon") quando o grupo permitir. */
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [observacao, setObservacao] = useState('');

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  const totalPorGrupo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const grupo of produto.optionGroups) {
      const soma = grupo.options.reduce(
        (total, opcao) => total + (quantidades[opcao.id] ?? 0),
        0,
      );
      mapa.set(grupo.id, soma);
    }
    return mapa;
  }, [produto.optionGroups, quantidades]);

  const faltando = produto.optionGroups.filter(
    (grupo) => (totalPorGrupo.get(grupo.id) ?? 0) < grupo.minSelect,
  );

  const escolhidos: Escolhido[] = produto.optionGroups.flatMap((grupo) =>
    grupo.options.flatMap((opcao) =>
      /* Uma entrada por unidade: e assim que a API cobra 2x o mesmo
         adicional. */
      Array.from({ length: quantidades[opcao.id] ?? 0 }, () => ({
        id: opcao.id,
        name: opcao.name,
        priceCents: opcao.priceCents,
      })),
    ),
  );

  const total =
    produto.priceCents + escolhidos.reduce((soma, opcao) => soma + opcao.priceCents, 0);

  function mudar(grupoId: string, opcao: Option, delta: number) {
    setQuantidades((atuais) => {
      const atual = atuais[opcao.id] ?? 0;
      const proximo = atual + delta;
      if (proximo < 0) return atuais;

      const grupo = produto.optionGroups.find((g) => g.id === grupoId)!;
      const totalDoGrupo = grupo.options.reduce(
        (soma, o) => soma + (o.id === opcao.id ? proximo : (atuais[o.id] ?? 0)),
        0,
      );
      if (totalDoGrupo > grupo.maxSelect) return atuais;

      return { ...atuais, [opcao.id]: proximo };
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-5"
      onClick={onFechar}
    >
      <div
        role="dialog"
        aria-label={`Adicionais de ${produto.name}`}
        onClick={(evento) => evento.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-borda bg-preto-2 p-5 sm:rounded-2xl"
      >
        <header className="mb-4">
          <h2 className="titulo-display text-lg">{produto.name}</h2>
          <p className="text-xs text-cinza-2">{produto.priceFormatted}</p>
        </header>

        {produto.optionGroups.map((grupo) => {
          const usado = totalPorGrupo.get(grupo.id) ?? 0;

          return (
            <section key={grupo.id} className="mb-4">
              <h3 className="mb-1.5 flex items-center gap-2 text-sm font-bold">
                {grupo.name}
                {grupo.minSelect > 0 && (
                  <span className="rounded bg-vermelho/20 px-1.5 text-[0.65rem] text-vermelho-2">
                    obrigatório
                  </span>
                )}
                <span className="ml-auto text-xs font-normal text-cinza-2">
                  {usado}/{grupo.maxSelect}
                </span>
              </h3>

              <ul className="space-y-1">
                {grupo.options.map((opcao) => {
                  const quantidade = quantidades[opcao.id] ?? 0;

                  return (
                    <li
                      key={opcao.id}
                      className={cx(
                        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                        quantidade > 0 ? 'border-amarelo/40 bg-amarelo/5' : 'border-borda',
                      )}
                    >
                      <span className="min-w-0 flex-1 text-sm">{opcao.name}</span>
                      {opcao.priceCents > 0 && (
                        <span className="shrink-0 text-xs text-cinza-2">
                          +{opcao.priceFormatted}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Tirar um ${opcao.name}`}
                        onClick={() => mudar(grupo.id, opcao, -1)}
                        disabled={quantidade === 0}
                        className="size-6 shrink-0 rounded border border-borda text-xs text-cinza disabled:opacity-30"
                      >
                        −
                      </button>
                      <span className="tabular w-4 shrink-0 text-center text-sm">{quantidade}</span>
                      <button
                        type="button"
                        aria-label={`Adicionar um ${opcao.name}`}
                        onClick={() => mudar(grupo.id, opcao, 1)}
                        disabled={usado >= grupo.maxSelect}
                        className="size-6 shrink-0 rounded border border-borda text-xs text-cinza disabled:opacity-30"
                      >
                        +
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <Input
          value={observacao}
          onChange={(evento) => setObservacao(evento.target.value)}
          placeholder="Observação (ex.: sem cebola)"
          className="mb-4"
        />

        {faltando.length > 0 && (
          <p className="mb-3 text-xs text-vermelho-2">
            Escolha: {faltando.map((grupo) => grupo.name).join(', ')}.
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="contorno" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            full
            variant="amarelo"
            disabled={faltando.length > 0}
            onClick={() => onConfirmar(escolhidos, observacao.trim())}
          >
            Adicionar · {formatBRL(total)}
          </Button>
        </div>
      </div>
    </div>
  );
}
