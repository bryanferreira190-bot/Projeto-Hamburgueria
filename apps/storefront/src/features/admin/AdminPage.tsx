import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatBRL } from '@adventure/shared';
import { adminApi } from '../../lib/adminApi';
import { useAdminAuth } from '../../lib/adminAuth';
import { resolveImageUrl } from '../../lib/imageUrl';
import { Button, EmptyState, Spinner } from '../../components/ui';
import { cx } from '../../lib/cx';
import { AdminLogin } from './AdminLogin';
import { NovoProdutoModal } from './NovoProdutoModal';
import { ProdutoEditor, type ProdutoDoCardapio } from './ProdutoEditor';

export function AdminPage() {
  const { accessToken, admin, verificado, entrar, marcarVerificado, sair } = useAdminAuth();

  /* Tenta retomar a sessao pelo cookie antes de decidir o que mostrar —
     sem isso, um F5 jogaria de volta para o login mesmo com sessao viva. */
  useEffect(() => {
    if (verificado) return;

    void (async () => {
      const renovou = await adminApi.renovarSessao();
      if (renovou) {
        try {
          const perfil = await adminApi.perfil();
          entrar(useAdminAuth.getState().accessToken!, perfil);
        } catch {
          useAdminAuth.getState().sair();
        }
      }
      marcarVerificado();
    })();
  }, [verificado, entrar, marcarVerificado]);

  if (!verificado) return <Spinner label="Verificando acesso" />;
  if (!accessToken || !admin) return <AdminLogin />;

  return <GerenciarCardapio nomeDoAdmin={admin.name} aoSair={sair} />;
}

function GerenciarCardapio({ nomeDoAdmin, aoSair }: { nomeDoAdmin: string; aoSair: () => void }) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<ProdutoDoCardapio | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvo, setSalvo] = useState<string | null>(null);

  const {
    data: categorias,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['admin-produtos'],
    queryFn: adminApi.produtos,
  });

  const sairDaConta = useMutation({
    mutationFn: adminApi.sair,
    onSettled: () => {
      aoSair();
      queryClient.clear();
    },
  });

  /* Usado tanto ao editar quanto ao cadastrar um produto novo — quem
     chama fecha a propria caixa (edicao ou o modal de cadastro) antes e
     passa a frase pronta, ja que "atualizado" e "cadastrado" pedem
     verbos diferentes. */
  const aposSalvar = (mensagem: string) => {
    setSalvo(mensagem);
    /* O cardapio publico tambem precisa refletir a mudanca na hora. */
    void queryClient.invalidateQueries({ queryKey: ['admin-produtos'] });
    void queryClient.invalidateQueries({ queryKey: ['menu'] });
    setTimeout(() => setSalvo(null), 3500);
  };

  if (isLoading) return <Spinner label="Carregando cardápio" />;

  if (isError || !categorias) {
    return (
      <EmptyState
        icon="⚠️"
        title="Não foi possível carregar o cardápio"
        action={
          <Link to="/">
            <Button variant="contorno">Voltar</Button>
          </Link>
        }
      />
    );
  }

  const totalProdutos = categorias.reduce((soma, c) => soma + c.products.length, 0);

  return (
    <div className="mx-auto max-w-4xl px-5 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-8">
        <div>
          <h1 className="titulo-display text-3xl">
            Gerenciar <span className="text-amarelo">cardápio</span>
          </h1>
          <p className="mt-1 text-sm text-cinza-2">
            {totalProdutos} produtos · logado como {nomeDoAdmin}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="contorno" size="sm" onClick={() => setCriando(true)}>
            + Novo produto
          </Button>
          <Link to="/">
            <Button variant="fantasma" size="sm">
              Ver loja
            </Button>
          </Link>
          <Button
            variant="fantasma"
            size="sm"
            onClick={() => sairDaConta.mutate()}
            loading={sairDaConta.isPending}
          >
            Sair
          </Button>
        </div>
      </header>

      {criando && (
        <NovoProdutoModal
          categorias={categorias.map((c) => ({ id: c.id, name: c.name }))}
          aoSalvar={(nome) => {
            setCriando(false);
            aposSalvar(`"${nome}" cadastrado. Adicione uma foto editando o produto.`);
          }}
          aoFechar={() => setCriando(false)}
        />
      )}

      {salvo && (
        <p
          role="status"
          className="mb-5 rounded-xl border border-verde/40 bg-verde/10 px-4 py-3 text-sm text-verde"
        >
          ✓ {salvo}
        </p>
      )}

      {categorias.map((categoria) => (
        <section key={categoria.id} className="mb-8">
          <h2 className="titulo-display mb-4 flex items-center gap-3 text-xl">
            <span className="text-vermelho">›</span>
            {categoria.name}
            <span className="text-sm font-normal text-cinza-2">({categoria.products.length})</span>
          </h2>

          <ul className="space-y-3">
            {categoria.products.map((produto) => {
              const emEdicao = editando?.id === produto.id;

              return (
                <li
                  key={produto.id}
                  className={cx(
                    'rounded-2xl border bg-preto-2 transition-colors',
                    emEdicao ? 'border-amarelo' : 'border-borda',
                  )}
                >
                  {emEdicao ? (
                    <div className="p-5">
                      <ProdutoEditor
                        produto={editando}
                        aoSalvar={() => {
                          setEditando(null);
                          aposSalvar(`"${editando.name}" atualizado.`);
                        }}
                        aoFechar={() => setEditando(null)}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-4 p-4">
                      <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-carvao">
                        {produto.imageUrl ? (
                          <img
                            src={resolveImageUrl(produto.imageUrl)!}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="grid size-full place-items-center text-2xl">🍔</div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-bold">
                          {produto.name}
                          {!produto.isAvailable && (
                            <span className="rounded-full bg-vermelho/15 px-2 py-0.5 text-[0.65rem] font-bold text-vermelho-2">
                              INDISPONÍVEL
                            </span>
                          )}
                        </p>
                        {produto.description && (
                          <p className="line-clamp-1 text-xs text-cinza-2">{produto.description}</p>
                        )}
                        <p className="mt-0.5 text-sm font-bold text-amarelo">
                          {formatBRL(produto.priceCents)}
                        </p>
                      </div>

                      <Button
                        size="sm"
                        variant="contorno"
                        onClick={() =>
                          setEditando({
                            id: produto.id,
                            name: produto.name,
                            description: produto.description,
                            imageUrl: produto.imageUrl,
                            priceCents: produto.priceCents,
                            isAvailable: produto.isAvailable,
                          })
                        }
                      >
                        Editar
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
