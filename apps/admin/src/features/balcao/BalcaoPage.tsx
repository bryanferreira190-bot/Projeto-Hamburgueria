import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { formatBRL, type PaymentMethod } from '@adventure/shared';
import {
  ApiError,
  api,
  type Category,
  type ManualOrderPayload,
  type OrderRow,
  type Product,
} from '../../lib/api';
import { Button, Card, Input, Spinner, Vazio } from '../../components/ui';
import { cx } from '../../lib/cx';
import { EscolherAdicionais } from './EscolherAdicionais';

/**
 * Formas de pagamento que existem no balcao. Todas sao liquidadas ali na
 * hora e NENHUMA passa pelo Mercado Pago — inclusive o PIX, que no balcao
 * e o QR fixo da loja. O campo so registra por onde o dinheiro entrou,
 * para o fechamento do caixa.
 */
const PAGAMENTOS: { value: PaymentMethod; rotulo: string; icone: string }[] = [
  { value: 'CASH_ON_DELIVERY', rotulo: 'Dinheiro', icone: '💵' },
  { value: 'CARD_ON_DELIVERY', rotulo: 'Maquininha', icone: '🏧' },
  { value: 'PIX', rotulo: 'PIX', icone: '⚡' },
];

/** Item ja montado, esperando ser lancado. */
export interface ItemDoBalcao {
  /** Chave local da linha — o mesmo produto pode entrar duas vezes com
      adicionais diferentes, entao productId nao serve de identidade. */
  chave: string;
  produto: Product;
  quantidade: number;
  adicionais: { id: string; name: string; priceCents: number }[];
  observacao: string;
}

export function BalcaoPage() {
  const queryClient = useQueryClient();

  const [itens, setItens] = useState<ItemDoBalcao[]>([]);
  const [busca, setBusca] = useState('');
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [produtoEscolhendo, setProdutoEscolhendo] = useState<Product | null>(null);

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pagamento, setPagamento] = useState<PaymentMethod>('CASH_ON_DELIVERY');
  const [recebido, setRecebido] = useState('');
  const [observacao, setObservacao] = useState('');

  const [erro, setErro] = useState<string | null>(null);
  const [lancado, setLancado] = useState<OrderRow | null>(null);

  const { data: categorias, isLoading } = useQuery({
    queryKey: ['menu'],
    queryFn: api.menu,
    staleTime: 5 * 60_000,
  });

  const lancar = useMutation({
    mutationFn: (payload: ManualOrderPayload) => api.createManualOrder(payload),
    onSuccess: (pedido) => {
      setLancado(pedido);
      limpar();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      setErro(error instanceof ApiError ? error.detail : 'Não foi possível lançar o pedido.');
    },
  });

  const totalPrevisto = useMemo(
    () =>
      itens.reduce((soma, item) => {
        const adicionais = item.adicionais.reduce((s, a) => s + a.priceCents, 0);
        return soma + (item.produto.priceCents + adicionais) * item.quantidade;
      }, 0),
    [itens],
  );

  const visiveis = useMemo(() => filtrar(categorias, busca, categoriaAtiva), [
    categorias,
    busca,
    categoriaAtiva,
  ]);

  function limpar() {
    setItens([]);
    setNome('');
    setTelefone('');
    setRecebido('');
    setObservacao('');
    setPagamento('CASH_ON_DELIVERY');
    setErro(null);
  }

  function adicionar(produto: Product, adicionais: ItemDoBalcao['adicionais'], obs: string) {
    setLancado(null);
    setItens((atuais) => {
      /* Mesmo produto com exatamente os mesmos adicionais e observacao
         vira quantidade, e nao uma segunda linha igual embaixo. */
      const assinatura = assinaturaDoItem(produto.id, adicionais, obs);
      const existente = atuais.find((item) => item.chave === assinatura);
      if (existente) {
        return atuais.map((item) =>
          item.chave === assinatura ? { ...item, quantidade: item.quantidade + 1 } : item,
        );
      }
      return [
        ...atuais,
        { chave: assinatura, produto, quantidade: 1, adicionais, observacao: obs },
      ];
    });
  }

  function aoClicarProduto(produto: Product) {
    /* Produto sem adicional nenhum nao precisa de tela intermediaria: no
       balcao, cada toque a menos conta. */
    if (produto.optionGroups.length === 0) adicionar(produto, [], '');
    else setProdutoEscolhendo(produto);
  }

  function mudarQuantidade(chave: string, delta: number) {
    setItens((atuais) =>
      atuais
        .map((item) =>
          item.chave === chave ? { ...item, quantidade: item.quantidade + delta } : item,
        )
        .filter((item) => item.quantidade > 0),
    );
  }

  function enviar() {
    setErro(null);

    const digitos = telefone.replace(/\D/g, '');
    if (digitos.length > 0 && digitos.length !== 11) {
      setErro('O telefone precisa ter DDD e 9 dígitos, ou ficar em branco.');
      return;
    }

    const centavosRecebidos = recebido.trim()
      ? Math.round(Number(recebido.replace(',', '.')) * 100)
      : undefined;

    if (centavosRecebidos !== undefined && Number.isNaN(centavosRecebidos)) {
      setErro('Valor recebido inválido.');
      return;
    }

    lancar.mutate({
      items: itens.map((item) => ({
        productId: item.produto.id,
        quantity: item.quantidade,
        /* Um adicional escolhido duas vezes viaja como o id repetido — e
           assim que a API cobra duas unidades dele. */
        optionIds: item.adicionais.map((adicional) => adicional.id),
        ...(item.observacao ? { notes: item.observacao } : {}),
      })),
      paymentMethod: pagamento,
      ...(nome.trim() ? { customerName: nome.trim() } : {}),
      ...(digitos ? { customerPhone: digitos } : {}),
      ...(observacao.trim() ? { notes: observacao.trim() } : {}),
      ...(pagamento === 'CASH_ON_DELIVERY' && centavosRecebidos !== undefined
        ? { changeForCents: centavosRecebidos }
        : {}),
    });
  }

  if (isLoading) return <Spinner label="Carregando o cardápio" />;

  const troco =
    pagamento === 'CASH_ON_DELIVERY' && recebido.trim()
      ? Math.round(Number(recebido.replace(',', '.')) * 100) - totalPrevisto
      : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="titulo-display text-2xl">
          Balcão <span className="text-cinza-2">· pedido presencial</span>
        </h1>
        {itens.length > 0 && (
          <Button variant="contorno" size="sm" onClick={limpar} disabled={lancar.isPending}>
            Limpar
          </Button>
        )}
      </header>

      {lancado && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-verde/40 bg-verde/10 px-4 py-3 text-sm font-bold text-verde"
        >
          <span aria-hidden>✅</span>
          Pedido {lancado.number} lançado — {lancado.totalFormatted}. Já está na aba Pedidos.
        </p>
      )}

      {erro && (
        <p
          role="alert"
          className="rounded-lg border border-vermelho/40 bg-vermelho/10 px-4 py-2 text-sm text-vermelho-2"
        >
          {erro}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ---------------- Cardapio ---------------- */}
        <div className="space-y-4">
          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar item do cardápio…"
          />

          <div className="flex flex-wrap gap-2">
            <Chip ativo={categoriaAtiva === null} onClick={() => setCategoriaAtiva(null)}>
              Tudo
            </Chip>
            {categorias?.map((categoria) => (
              <Chip
                key={categoria.id}
                ativo={categoriaAtiva === categoria.slug}
                onClick={() => setCategoriaAtiva(categoria.slug)}
              >
                {categoria.name}
              </Chip>
            ))}
          </div>

          {visiveis.length === 0 ? (
            <Vazio icon="🔍" title="Nenhum item encontrado" />
          ) : (
            visiveis.map((categoria) => (
              <section key={categoria.id}>
                <h2 className="mb-2 text-sm font-bold text-cinza-2">{categoria.name}</h2>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {categoria.products.map((produto) => (
                    <button
                      key={produto.id}
                      type="button"
                      disabled={!produto.isAvailable}
                      onClick={() => aoClicarProduto(produto)}
                      className={cx(
                        'rounded-lg border border-borda bg-preto-2 p-3 text-left transition-colors',
                        'hover:border-amarelo disabled:cursor-not-allowed disabled:opacity-40',
                      )}
                    >
                      <span className="block text-sm font-semibold">{produto.name}</span>
                      <span className="mt-0.5 block text-xs text-amarelo">
                        {produto.priceFormatted}
                        {produto.optionGroups.length > 0 && (
                          <span className="text-cinza-2"> · com adicionais</span>
                        )}
                      </span>
                      {!produto.isAvailable && (
                        <span className="mt-1 block text-xs text-vermelho-2">Indisponível</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* ---------------- Comanda ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card title={`Comanda (${itens.length})`}>
            {itens.length === 0 ? (
              <p className="py-6 text-center text-xs text-cinza-2">
                Toque nos itens do cardápio para montar o pedido.
              </p>
            ) : (
              <ul className="space-y-3">
                {itens.map((item) => (
                  <li key={item.chave} className="border-b border-borda/50 pb-3 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{item.produto.name}</p>
                        {item.adicionais.map((adicional, indice) => (
                          <p key={indice} className="pl-3 text-xs text-verde">
                            + {adicional.name}
                          </p>
                        ))}
                        {item.observacao && (
                          <p className="pl-3 text-xs text-vermelho-2">⚠ {item.observacao}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-cinza">
                        {formatBRL(
                          (item.produto.priceCents +
                            item.adicionais.reduce((s, a) => s + a.priceCents, 0)) *
                            item.quantidade,
                        )}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center gap-2">
                      <BotaoQuantidade
                        rotulo={`Tirar um ${item.produto.name}`}
                        onClick={() => mudarQuantidade(item.chave, -1)}
                      >
                        −
                      </BotaoQuantidade>
                      <span className="tabular w-6 text-center text-sm font-bold">
                        {item.quantidade}
                      </span>
                      <BotaoQuantidade
                        rotulo={`Adicionar um ${item.produto.name}`}
                        onClick={() => mudarQuantidade(item.chave, 1)}
                      >
                        +
                      </BotaoQuantidade>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Cliente (opcional)">
            <div className="space-y-2">
              <Input
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                placeholder="Nome para chamar"
              />
              <Input
                value={telefone}
                onChange={(event) => setTelefone(mascararTelefone(event.target.value))}
                placeholder="WhatsApp (opcional)"
              />
              <p className="text-xs text-cinza-2">
                Com WhatsApp, o cliente também acompanha o pedido pelo site.
              </p>
            </div>
          </Card>

          <Card title="Pagamento">
            <div className="grid grid-cols-3 gap-2">
              {PAGAMENTOS.map((opcao) => (
                <button
                  key={opcao.value}
                  type="button"
                  onClick={() => setPagamento(opcao.value)}
                  className={cx(
                    'rounded-lg border p-2 text-center text-xs font-bold transition-colors',
                    pagamento === opcao.value
                      ? 'border-amarelo bg-amarelo/10 text-amarelo'
                      : 'border-borda text-cinza hover:border-cinza-2',
                  )}
                >
                  <span className="block text-base" aria-hidden>
                    {opcao.icone}
                  </span>
                  {opcao.rotulo}
                </button>
              ))}
            </div>

            {pagamento === 'CASH_ON_DELIVERY' && (
              <div className="mt-3">
                <Input
                  value={recebido}
                  onChange={(event) => setRecebido(event.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="Valor recebido (para o troco)"
                  inputMode="decimal"
                />
                {troco !== null && !Number.isNaN(troco) && (
                  <p
                    className={cx(
                      'mt-1.5 text-sm font-bold',
                      troco < 0 ? 'text-vermelho-2' : 'text-verde',
                    )}
                  >
                    {troco < 0
                      ? `Faltam ${formatBRL(Math.abs(troco))}`
                      : `Troco: ${formatBRL(troco)}`}
                  </p>
                )}
              </div>
            )}

            <Input
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              placeholder="Observação do pedido"
              className="mt-3"
            />
          </Card>

          <div className="rounded-xl border border-borda bg-preto-2 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-cinza">Total</span>
              <span className="titulo-display text-2xl text-amarelo">
                {formatBRL(totalPrevisto)}
              </span>
            </div>
            <p className="mb-3 text-xs text-cinza-2">
              O valor final é conferido pelo servidor ao lançar o pedido.
            </p>
            <Button
              full
              variant="amarelo"
              onClick={enviar}
              loading={lancar.isPending}
              disabled={itens.length === 0}
            >
              Lançar pedido
            </Button>
          </div>
        </div>
      </div>

      {produtoEscolhendo && (
        <EscolherAdicionais
          produto={produtoEscolhendo}
          onFechar={() => setProdutoEscolhendo(null)}
          onConfirmar={(adicionais, obs) => {
            adicionar(produtoEscolhendo, adicionais, obs);
            setProdutoEscolhendo(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Auxiliares ---------------- */

function filtrar(
  categorias: Category[] | undefined,
  busca: string,
  categoriaAtiva: string | null,
): Category[] {
  if (!categorias) return [];

  const termo = busca.trim().toLowerCase();

  /* Busca ignora a categoria selecionada: quem digita quer achar o item
     em qualquer lugar do cardapio. */
  if (termo) {
    return categorias
      .map((categoria) => ({
        ...categoria,
        products: categoria.products.filter((produto) =>
          produto.name.toLowerCase().includes(termo),
        ),
      }))
      .filter((categoria) => categoria.products.length > 0);
  }

  return categoriaAtiva
    ? categorias.filter((categoria) => categoria.slug === categoriaAtiva)
    : categorias;
}

function assinaturaDoItem(
  productId: string,
  adicionais: { id: string }[],
  observacao: string,
): string {
  /* Ordenado para "bacon + cheddar" e "cheddar + bacon" contarem como a
     mesma linha. */
  const ids = adicionais.map((adicional) => adicional.id).sort().join(',');
  return `${productId}|${ids}|${observacao.trim().toLowerCase()}`;
}

function mascararTelefone(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 7) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'rounded-full border px-3 py-1 text-xs font-bold transition-colors',
        ativo ? 'border-amarelo bg-amarelo/10 text-amarelo' : 'border-borda text-cinza',
      )}
    >
      {children}
    </button>
  );
}

function BotaoQuantidade({
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
      className="size-7 rounded-lg border border-borda text-sm font-bold text-cinza transition-colors hover:border-amarelo hover:text-amarelo"
    >
      {children}
    </button>
  );
}
