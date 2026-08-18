import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ORDER_STATUS_LABELS,
  OrderStatus,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  isOnlinePayment,
  nextStatusFor,
  type OrderType,
  type PaymentMethod,
} from '@adventure/shared';
import { ApiError, api, nomeDoCliente, type OrderRow } from '../../lib/api';
import { Button, Card, Input, Spinner, Vazio } from '../../components/ui';
import { DadosDoCliente } from '../../components/DadosDoCliente';
import { cx } from '../../lib/cx';
import { COLUNAS, usePedidosGlobais } from './usePedidosGlobais';

/* Referencia estavel: um array novo a cada render dispararia efeitos a
   toa em quem depende deste resultado. */
const SEM_PEDIDOS: OrderRow[] = [];

/** Pagar na entrega e o oposto de pagar pelo site — ver isOnlinePayment. */
function ehPagamentoNaEntrega(metodo: string): boolean {
  return !isOnlinePayment(metodo as PaymentMethod);
}

function rotuloDoPagamento(metodo: string): string {
  return PAYMENT_METHOD_LABELS[metodo as PaymentMethod] ?? metodo;
}

/** Quantos cartoes cada coluna mostra antes do botao "ver mais". */
const CARTOES_POR_COLUNA = 5;

export function OrdersPage() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /* Uma coluna cheia (pico do fim de semana, por exemplo) nao deveria
     empurrar as outras para fora da tela — cada coluna comeca fechada
     e so mostra tudo se alguem pedir. */
  const [colunasExpandidas, setColunasExpandidas] = useState<Set<OrderStatus>>(new Set());

  /* So dispara a busca 300ms depois da ultima tecla — sem isto, cada
     tecla digitada virava uma chamada HTTP nova (queryKey mudando a
     cada letra), e digitar "hamburguer" chegava a gerar dez requisicoes
     pra API na tela que a cozinha deixa aberta o dia inteiro. */
  useEffect(() => {
    const temporizador = setTimeout(() => setBuscaDebounced(busca), 300);
    return () => clearTimeout(temporizador);
  }, [busca]);

  /**
   * Sem busca, os dados vem prontos do Layout (usePedidosGlobais) — ja
   * estao quentes no cache antes mesmo desta pagina montar, entao trocar
   * de aba e voltar para Pedidos nao mostra spinner nenhum. So dispara
   * uma consulta PROPRIA quando ha termo de busca: e um recorte diferente
   * (filtro no servidor), que nao faz sentido compartilhar com o polling
   * global.
   */
  const buscaAtiva = buscaDebounced.length > 0;
  const { pedidos: pedidosGlobais, isLoading: carregandoGlobal } = usePedidosGlobais();
  const { data: dadosDaBusca, isLoading: carregandoBusca } = useQuery({
    queryKey: ['orders', 'busca', buscaDebounced],
    queryFn: () => api.orders({ limit: 100, search: buscaDebounced }),
    enabled: buscaAtiva,
  });

  const pedidos = buscaAtiva ? (dadosDaBusca?.orders ?? SEM_PEDIDOS) : pedidosGlobais;
  const carregando = buscaAtiva ? carregandoBusca : carregandoGlobal;

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.updateOrderStatus(id, status),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      /* Mudar status pode creditar (entra em preparo) ou anular (cancela)
         cashback — sem isto, quem estiver com a aba Cashback aberta em
         outra tela veria um numero desatualizado por ate 60s (staleTime
         daquela query). */
      void queryClient.invalidateQueries({ queryKey: ['cashback'] });
    },
    onError: (error) => {
      setErro(error instanceof ApiError ? error.detail : 'Não foi possível mudar o status.');
    },
  });

  if (carregando) return <Spinner label="Carregando pedidos" />;

  const emAndamento = pedidos.filter((pedido) =>
    COLUNAS.some((coluna) => coluna.status === pedido.status),
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="titulo-display text-2xl">
          Pedidos
          {emAndamento.length > 0 && (
            <span className="ml-2 rounded-full bg-vermelho px-2.5 py-0.5 align-middle text-sm">
              {emAndamento.length}
            </span>
          )}
        </h1>

        <div className="flex flex-1 items-center justify-end gap-2">
          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar por número, nome ou telefone…"
            className="max-w-xs"
          />
        </div>
      </header>

      {erro && (
        <p
          role="alert"
          className="rounded-lg border border-vermelho/40 bg-vermelho/10 px-4 py-2 text-sm text-vermelho-2"
        >
          {erro}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {COLUNAS.map((coluna) => {
          const daColuna = pedidos.filter((pedido) => pedido.status === coluna.status);
          const expandida = colunasExpandidas.has(coluna.status);
          const visiveis = expandida ? daColuna : daColuna.slice(0, CARTOES_POR_COLUNA);
          const escondidos = daColuna.length - visiveis.length;

          return (
            <section key={coluna.status} className="min-w-0">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <span aria-hidden>{coluna.icone}</span>
                {coluna.titulo}
                <span className="text-cinza-2">({daColuna.length})</span>
              </h2>

              <div className="space-y-3">
                {daColuna.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-borda py-8 text-center text-xs text-cinza-2">
                    Nenhum pedido
                  </div>
                ) : (
                  visiveis.map((pedido) => (
                    <CartaoPedido
                      key={pedido.id}
                      pedido={pedido}
                      onAvancar={(status) => mudarStatus.mutate({ id: pedido.id, status })}
                      onCancelar={() =>
                        mudarStatus.mutate({
                          id: pedido.id,
                          status: OrderStatus.CANCELED,
                        })
                      }
                      ocupado={mudarStatus.isPending}
                    />
                  ))
                )}

                {escondidos > 0 && (
                  <Button
                    size="sm"
                    variant="contorno"
                    full
                    onClick={() =>
                      setColunasExpandidas((atual) => new Set(atual).add(coluna.status))
                    }
                  >
                    Mostrar mais {escondidos}
                  </Button>
                )}

                {expandida && daColuna.length > CARTOES_POR_COLUNA && (
                  <Button
                    size="sm"
                    variant="contorno"
                    full
                    onClick={() =>
                      setColunasExpandidas((atual) => {
                        const proximo = new Set(atual);
                        proximo.delete(coluna.status);
                        return proximo;
                      })
                    }
                  >
                    Mostrar menos
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Card title="Histórico recente">
        <Historico
          pedidos={pedidos.filter(
            (pedido) => !COLUNAS.some((coluna) => coluna.status === pedido.status),
          )}
        />
      </Card>
    </div>
  );
}

function CartaoPedido({
  pedido,
  onAvancar,
  onCancelar,
  ocupado,
}: {
  pedido: OrderRow;
  onAvancar: (status: string) => void;
  onCancelar: () => void;
  ocupado: boolean;
}) {
  /* O proximo status vem da mesma maquina de estados que a API usa, entao
     o botao nunca oferece uma transicao que o servidor vai recusar. */
  const proximo = nextStatusFor(pedido.status as OrderStatus, pedido.type as OrderType);

  const minutos = Math.floor((Date.now() - new Date(pedido.createdAt).getTime()) / 60_000);
  const atrasado = minutos > 40 && pedido.status !== OrderStatus.PENDING_PAYMENT;

  return (
    <article
      className={cx(
        'rounded-lg border bg-preto-2 p-4',
        atrasado ? 'border-[#d03b3b]' : 'border-borda',
      )}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <DadosDoCliente pedido={pedido}>
            <span className="titulo-display text-xl text-amarelo">{pedido.number}</span>
          </DadosDoCliente>
          <p className="text-xs text-cinza">
            {pedido.isManual
              ? '🧾 Balcão'
              : pedido.type === 'DELIVERY'
                ? '🛵 Entrega'
                : '🏪 Retirada'}{' '}
            · {pedido.totalFormatted}
          </p>
        </div>
        <span
          className={cx('tabular text-xs', atrasado ? 'font-bold text-[#d03b3b]' : 'text-cinza-2')}
        >
          {atrasado && <span aria-hidden>⚠ </span>}
          {minutos}min
        </span>
      </header>

      <div className="mb-2">
        <DadosDoCliente pedido={pedido}>
          <span className="text-sm font-semibold">{nomeDoCliente(pedido) ?? 'Sem nome'}</span>
        </DadosDoCliente>
      </div>

      <ul className="mb-3 space-y-0.5 text-xs text-cinza">
        {pedido.items.map((item, index) => (
          <li key={index}>
            <span className="text-amarelo">{item.quantity}×</span> {item.productName}
            {/* Adicionais em verde e observacao em vermelho: na correria da
                cozinha, a cor separa "poe isso" de "tira isso" antes mesmo
                de ler. */}
            {item.options.map((opcao) => (
              <span key={opcao.name} className="block pl-4 font-semibold text-verde">
                + {opcao.quantity > 1 && `${opcao.quantity}× `}
                {opcao.name}
              </span>
            ))}
            {item.notes && (
              <span className="block pl-4 font-semibold text-vermelho-2">⚠ {item.notes}</span>
            )}
          </li>
        ))}
      </ul>

      {pedido.address && (
        <p className="mb-2 text-xs text-cinza-2">
          📍 {pedido.address.street}, {pedido.address.number} — {pedido.address.district}
        </p>
      )}

      {pedido.notes && (
        <p className="mb-2 rounded bg-carvao px-2 py-1 text-xs text-cinza italic">
          Obs.: {pedido.notes}
        </p>
      )}

      {ehPagamentoNaEntrega(pedido.paymentMethod) ? (
        /* Pagamento na entrega nao passou pelo Mercado Pago — quem entrega
           precisa cobrar na hora. Por isso o destaque forte: e a unica
           informacao deste cartao em que um erro custa dinheiro de verdade
           saindo do bolso de quem entregou. */
        <p className="mb-3 flex items-center gap-1.5 rounded-lg border border-amarelo/40 bg-amarelo/10 px-2.5 py-1.5 text-xs font-bold text-amarelo">
          <span aria-hidden>{pedido.paymentMethod === 'CASH_ON_DELIVERY' ? '💵' : '🏧'}</span>
          Cobrar na entrega — {rotuloDoPagamento(pedido.paymentMethod)}
          {pedido.changeForCents !== null && (
            <span className="font-normal text-amarelo/80">
              · troco para {formatBRL(pedido.changeForCents)}
            </span>
          )}
        </p>
      ) : (
        <p className="mb-3 text-xs text-cinza-2">{rotuloDoPagamento(pedido.paymentMethod)}</p>
      )}

      <div className="flex gap-2">
        {proximo && (
          <Button
            size="sm"
            variant="amarelo"
            full
            disabled={ocupado}
            onClick={() => onAvancar(proximo)}
          >
            {ORDER_STATUS_LABELS[proximo]}
          </Button>
        )}
        <Button size="sm" variant="contorno" disabled={ocupado} onClick={onCancelar}>
          ✕
        </Button>
      </div>
    </article>
  );
}

/** Linhas por pagina do historico. */
const LINHAS_POR_PAGINA = 15;

function Historico({ pedidos }: { pedidos: OrderRow[] }) {
  const [pagina, setPagina] = useState(1);

  const totalDePaginas = Math.max(1, Math.ceil(pedidos.length / LINHAS_POR_PAGINA));
  /* A lista muda (novo pedido finalizado, busca digitada) e a pagina
     antiga pode nao existir mais — volta para a ultima valida em vez de
     mostrar uma tabela vazia com botao "anterior" sem efeito. */
  const paginaAtual = Math.min(pagina, totalDePaginas);
  const inicio = (paginaAtual - 1) * LINHAS_POR_PAGINA;
  const daPagina = pedidos.slice(inicio, inicio + LINHAS_POR_PAGINA);

  if (pedidos.length === 0) {
    return <Vazio icon="📋" title="Nenhum pedido finalizado ainda" />;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borda text-left text-xs text-cinza-2 uppercase">
              <th className="pb-2 font-semibold">Nº</th>
              <th className="pb-2 font-semibold">Cliente</th>
              <th className="pb-2 font-semibold">Pagamento</th>
              <th className="pb-2 font-semibold">Status</th>
              <th className="pb-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {daPagina.map((pedido) => (
              <tr key={pedido.id} className="border-b border-borda/50">
                <td className="py-2">
                  <DadosDoCliente pedido={pedido}>
                    <span className="font-bold text-amarelo">{pedido.number}</span>
                  </DadosDoCliente>
                </td>
                <td className="py-2">
                  <DadosDoCliente pedido={pedido}>
                    <span className="text-cinza">
                      {pedido.isManual && <span aria-hidden>🧾 </span>}
                      {nomeDoCliente(pedido) ?? 'Sem nome'}
                    </span>
                  </DadosDoCliente>
                </td>
                <td className="py-2 text-xs whitespace-nowrap">
                  {ehPagamentoNaEntrega(pedido.paymentMethod) ? (
                    /* Mesma linguagem visual do cartao da cozinha: no
                     historico o que se procura e justamente conferir se um
                     pedido era para cobrar na entrega. */
                    <span className="font-semibold text-amarelo">
                      <span aria-hidden>
                        {pedido.paymentMethod === 'CASH_ON_DELIVERY' ? '💵 ' : '🏧 '}
                      </span>
                      {rotuloDoPagamento(pedido.paymentMethod)}
                    </span>
                  ) : (
                    <span className="text-cinza-2">{rotuloDoPagamento(pedido.paymentMethod)}</span>
                  )}
                </td>
                <td className="py-2">
                  <span
                    className={cx(
                      'rounded-full px-2 py-0.5 text-xs',
                      pedido.status === OrderStatus.CANCELED
                        ? 'bg-[#d03b3b]/15 text-[#d03b3b]'
                        : 'bg-[#0ca30c]/15 text-[#0ca30c]',
                    )}
                  >
                    {ORDER_STATUS_LABELS[pedido.status as OrderStatus] ?? pedido.status}
                  </span>
                </td>
                <td className="tabular py-2 text-right">{pedido.totalFormatted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalDePaginas > 1 && (
        <Paginacao total={totalDePaginas} atual={paginaAtual} onMudar={setPagina} />
      )}
    </div>
  );
}

function Paginacao({
  total,
  atual,
  onMudar,
}: {
  total: number;
  atual: number;
  onMudar: (pagina: number) => void;
}) {
  return (
    <nav
      className="mt-4 flex items-center justify-center gap-1.5"
      aria-label="Paginas do historico"
    >
      <Button
        size="sm"
        variant="contorno"
        disabled={atual === 1}
        onClick={() => onMudar(atual - 1)}
      >
        ‹
      </Button>

      {Array.from({ length: total }, (_, indice) => indice + 1).map((numero) => (
        <button
          key={numero}
          type="button"
          onClick={() => onMudar(numero)}
          aria-current={numero === atual ? 'page' : undefined}
          className={cx(
            'size-8 shrink-0 rounded-lg text-xs font-bold transition-colors',
            numero === atual
              ? 'bg-amarelo text-preto'
              : 'text-cinza-2 hover:bg-preto-3 hover:text-cinza',
          )}
        >
          {numero}
        </button>
      ))}

      <Button
        size="sm"
        variant="contorno"
        disabled={atual === total}
        onClick={() => onMudar(atual + 1)}
      >
        ›
      </Button>
    </nav>
  );
}
