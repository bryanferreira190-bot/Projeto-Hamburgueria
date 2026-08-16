import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, type Product } from '../../lib/api';
import { resolveImageUrl } from '../../lib/imageUrl';
import { Button, EmptyState, Spinner } from '../../components/ui';
import { cx } from '../../lib/cx';
import { ProdutoModal } from './ProdutoModal';

export function MenuPage() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const {
    data: categories,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['menu'],
    queryFn: api.getMenu,
    staleTime: 5 * 60_000,
  });

  const visible = useMemo(() => {
    if (!categories) return [];

    return activeCategory
      ? categories.filter((category) => category.slug === activeCategory)
      : categories;
  }, [categories, activeCategory]);

  if (isLoading) return <Spinner label="Carregando o cardápio" />;

  if (isError) {
    return (
      <EmptyState
        icon="⚠️"
        title="Não conseguimos carregar o cardápio"
        description="Verifique sua conexão e tente novamente."
        action={
          <Button onClick={() => void refetch()} variant="contorno">
            Tentar de novo
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="mx-auto max-w-6xl px-5">
        <section className="py-8 text-center sm:py-12">
          <span className="mb-4 inline-block rounded-full border border-amarelo/35 bg-amarelo/8 px-4 py-1.5 text-[0.72rem] font-extrabold tracking-[0.2em] text-amarelo uppercase">
            Peça Online
          </span>
          <h1 className="titulo-display text-4xl sm:text-5xl">
            MONTE SEU <span className="text-amarelo">PEDIDO</span>
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-cinza">
            Escolha seus itens, informe o endereço e pronto. Sai da chapa direto para você.
          </p>
        </section>
      </div>

      {/*
        Sem max-w-6xl de proposito, e fora do container acima: e assim que
        este bloco cobre a largura inteira da tela em vez de parar na
        largura do conteudo — <main>, o pai dele, nao tem nenhum limite de
        largura (ver App.tsx). Um "furo" via left/translate funcionaria
        para position:relative, mas NAO para position:sticky (nesse modo,
        left/right sao deslocamento a partir da posicao normal, nao
        porcentagem do container — o calculo simplesmente da errado e a
        faixa sai da tela). Ficar fora do container e o jeito que funciona
        sempre, sticky ou nao.

        Fundo solido, sem blur: nao ha transparencia por cima do preto
        opaco para borrar.
      */}
      <div className="sticky top-[68px] z-30 mb-10 w-full bg-preto py-3">
        <div className="mx-auto max-w-6xl px-5">
          <div className="sem-scrollbar flex gap-2 overflow-x-auto pb-1">
            <CategoryTab
              label="Tudo"
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            />
            {categories?.map((category) => (
              <CategoryTab
                key={category.id}
                label={category.name}
                active={activeCategory === category.slug}
                onClick={() => setActiveCategory(category.slug)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-24">
        {visible.length === 0 ? (
          <EmptyState
            icon="🍔"
            title="Nenhum produto nesta categoria"
            description="Escolha outra categoria no menu acima."
            action={
              <Button variant="contorno" onClick={() => setActiveCategory(null)}>
                Ver tudo
              </Button>
            }
          />
        ) : (
          visible.map((category) => (
            <section key={category.id} className="mb-12">
              <h2 className="titulo-display mb-5 flex items-center gap-3 text-2xl">
                <span className="text-vermelho">›</span>
                {category.name}
                <span className="text-sm font-normal text-cinza-2">
                  ({category.products.length})
                </span>
              </h2>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function CategoryTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'shrink-0 rounded-full border px-5 py-2 text-sm font-bold transition-all',
        active
          ? 'border-amarelo bg-amarelo text-preto'
          : 'border-borda bg-preto-3 text-cinza hover:border-cinza-2 hover:text-white',
      )}
    >
      {label}
    </button>
  );
}

function ProductCard({ product }: { product: Product }) {
  /* A caixa de escolha e a unica porta de entrada do carrinho: mesmo
     produto sem adicional nenhum passa por ela, para o cliente sempre
     ter onde escrever "sem cebola". */
  const [escolhendo, setEscolhendo] = useState(false);

  return (
    <article
      className={cx(
        'animar-surgir flex flex-col overflow-hidden rounded-2xl border border-borda bg-preto-3',
        'transition-all duration-300 hover:-translate-y-2 hover:border-amarelo',
        !product.isAvailable && 'opacity-55',
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-carvao">
        {product.imageUrl ? (
          <img
            src={resolveImageUrl(product.imageUrl)!}
            alt={product.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-700 hover:scale-108"
          />
        ) : (
          <div className="grid size-full place-items-center text-5xl">🍔</div>
        )}

        {!product.isAvailable && (
          <div className="absolute inset-0 grid place-items-center bg-preto/75">
            <span className="rounded-full bg-vermelho px-4 py-1.5 text-xs font-bold">
              INDISPONÍVEL
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="titulo-display mb-1.5 text-lg">{product.name}</h3>
        {product.description && (
          <p className="mb-4 line-clamp-3 flex-1 text-sm leading-relaxed text-cinza">
            {product.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3">
          <span className="titulo-display text-xl text-amarelo">{product.priceFormatted}</span>

          <Button
            size="sm"
            disabled={!product.isAvailable}
            onClick={() => setEscolhendo(true)}
          >
            Adicionar
          </Button>
        </div>
      </div>

      {escolhendo && <ProdutoModal produto={product} aoFechar={() => setEscolhendo(false)} />}
    </article>
  );
}
