import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ORDER_STATUS_LABELS,
  OrderStatus,
  PAYMENT_METHOD_LABELS,
  nextStatusFor,
  type OrderType,
  type PaymentMethod,
} from '@adventure/shared';
import { ApiError, api, type OrderRow } from '../../lib/api';
import { Button, Card, Input, Spinner, Vazio } from '../../components/ui';
import { cx } from '../../lib/cx';

/** Colunas do painel de cozinha, na ordem em que o pedido caminha. */
const COLUNAS: { status: OrderStatus; titulo: string; icone: string }[] = [
  {
    status: OrderStatus.PENDING_PAYMENT,
    titulo: 'Aguardando pagamento',
    icone: '⏳',
  },
  { status: OrderStatus.CONFIRMED, titulo: 'Novos', icone: '🔔' },
  { status: OrderStatus.PREPARING, titulo: 'Em preparo', icone: '👨‍🍳' },
  { status: OrderStatus.READY, titulo: 'Prontos', icone: '🍔' },
];

export function OrdersPage() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', busca],
    queryFn: () => api.orders({ limit: 100, ...(busca ? { search: busca } : {}) }),
    /* A cozinha precisa ver pedido novo sem apertar F5. */
    refetchInterval: 15_000,
  });

  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.updateOrderStatus(id, status),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      setErro(error instanceof ApiError ? error.detail : 'Não foi possível mudar o status.');
    },
  });

  if (isLoading) return <Spinner label="Carregando pedidos" />;

  const pedidos = data?.orders ?? [];
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

        <Input
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder="Buscar por número, nome ou telefone…"
          className="max-w-xs"
        />
      </header>

      {erro && (
        <p
          role="alert"
          className="rounded-lg border border-vermelho/40 bg-vermelho/10 px-4 py-2 text-sm text-vermelho-2"
        >
          {erro}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {COLUNAS.map((coluna) => {
          const daColuna = pedidos.filter((pedido) => pedido.status === coluna.status);

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
                  daColuna.map((pedido) => (
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
          <p className="titulo-display text-xl text-amarelo">{pedido.number}</p>
          <p className="text-xs text-cinza">
            {pedido.type === 'DELIVERY' ? '🛵 Entrega' : '🏪 Retirada'} · {pedido.totalFormatted}
          </p>
        </div>
        <span
          className={cx('tabular text-xs', atrasado ? 'font-bold text-[#d03b3b]' : 'text-cinza-2')}
        >
          {atrasado && <span aria-hidden>⚠ </span>}
          {minutos}min
        </span>
      </header>

      <p className="mb-2 text-sm font-semibold">{pedido.customer.name ?? 'Sem nome'}</p>

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

      <p className="mb-3 text-xs text-cinza-2">
        {PAYMENT_METHOD_LABELS[pedido.paymentMethod as PaymentMethod] ?? pedido.paymentMethod}
      </p>

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

function Historico({ pedidos }: { pedidos: OrderRow[] }) {
  if (pedidos.length === 0) {
    return <Vazio icon="📋" title="Nenhum pedido finalizado ainda" />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-borda text-left text-xs text-cinza-2 uppercase">
            <th className="pb-2 font-semibold">Nº</th>
            <th className="pb-2 font-semibold">Cliente</th>
            <th className="pb-2 font-semibold">Status</th>
            <th className="pb-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.slice(0, 15).map((pedido) => (
            <tr key={pedido.id} className="border-b border-borda/50">
              <td className="py-2 font-bold text-amarelo">{pedido.number}</td>
              <td className="py-2 text-cinza">{pedido.customer.name ?? '—'}</td>
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
  );
}
