import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatBRL,
  type OrderStatus,
  type PaymentMethod,
} from '@adventure/shared';
import { ApiError, api } from '../../lib/api';
import { Badge, Button, EmptyState, Field, Input, Spinner } from '../../components/ui';
import { cx } from '../../lib/cx';

/** Etapas visiveis ao cliente, na ordem em que acontecem. */
const STEPS: { status: OrderStatus; icon: string }[] = [
  { status: 'CONFIRMED', icon: '✅' },
  { status: 'PREPARING', icon: '👨‍🍳' },
  { status: 'READY', icon: '🍔' },
  { status: 'OUT_FOR_DELIVERY', icon: '🛵' },
  { status: 'DELIVERED', icon: '🎉' },
];

export function TrackPage() {
  const { number } = useParams<{ number: string }>();
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  if (!number) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <h1 className="titulo-display mb-2 text-3xl">
          ACOMPANHAR <span className="text-amarelo">PEDIDO</span>
        </h1>
        <p className="mb-6 text-cinza">Informe o número que você recebeu ao finalizar.</p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (search.trim()) void navigate(`/pedido/${search.trim().toUpperCase()}`);
          }}
          className="space-y-4"
        >
          <Field label="Número do pedido">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value.toUpperCase())}
              placeholder="A001"
              maxLength={12}
            />
          </Field>
          <Button full type="submit" disabled={!search.trim()}>
            Acompanhar
          </Button>
        </form>

        <Link to="/" className="mt-6 block text-center text-sm text-cinza underline">
          Voltar ao cardápio
        </Link>
      </div>
    );
  }

  return <OrderDetail number={number} />;
}

function OrderDetail({ number }: { number: string }) {
  const queryClient = useQueryClient();
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);

  const {
    data: order,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['order', number],
    queryFn: () => api.trackOrder(number),
    /* Enquanto o pedido esta ativo, revalida sozinho para o cliente ver o
       status mudar sem precisar atualizar a pagina. */
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const finalizado = status === 'DELIVERED' || status === 'COMPLETED' || status === 'CANCELED';
      return finalizado ? false : 20_000;
    },
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => api.cancelOrder(number, reason),
    onSuccess: () => {
      setShowCancel(false);
      void queryClient.invalidateQueries({ queryKey: ['order', number] });
    },
  });

  if (isLoading) return <Spinner label="Buscando seu pedido" />;

  if (isError || !order) {
    return (
      <EmptyState
        icon="🔍"
        title="Pedido não encontrado"
        description={`Não achamos o pedido ${number}. Confira o número.`}
        action={
          <Link to="/pedido">
            <Button variant="contorno">Buscar outro</Button>
          </Link>
        }
      />
    );
  }

  const isCanceled = order.status === 'CANCELED';
  const currentStep = STEPS.findIndex((step) => step.status === order.status);
  const canCancel = order.status === 'PENDING_PAYMENT' || order.status === 'CONFIRMED';

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24">
      <div className="py-8 text-center">
        <p className="text-sm text-cinza">Pedido</p>
        <h1 className="titulo-display text-5xl text-amarelo">{order.number}</h1>
        <div className="mt-3 flex justify-center">
          <Badge tone={isCanceled ? 'perigo' : order.status === 'DELIVERED' ? 'sucesso' : 'alerta'}>
            {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
          </Badge>
        </div>
      </div>

      {isCanceled ? (
        <div className="mb-6 rounded-2xl border border-vermelho/40 bg-vermelho/8 p-5 text-center">
          <p className="font-bold text-vermelho-2">Pedido cancelado</p>
          {order.cancelReason && (
            <p className="mt-1 text-sm text-cinza">Motivo: {order.cancelReason}</p>
          )}
        </div>
      ) : (
        <ol className="mb-8 space-y-1">
          {STEPS.filter(
            (step) =>
              /* Retirada nao passa por "saiu para entrega". */
              !(order.type === 'PICKUP' && step.status === 'OUT_FOR_DELIVERY'),
          ).map((step, index) => {
            const done = currentStep >= 0 && index <= currentStep;
            const active = index === currentStep;

            return (
              <li key={step.status} className="flex items-center gap-4">
                <div
                  className={cx(
                    'grid size-11 shrink-0 place-items-center rounded-full border-2 text-lg transition-colors',
                    done ? 'border-amarelo bg-amarelo/15' : 'border-borda bg-preto-3 opacity-40',
                    active && 'animate-pulse',
                  )}
                >
                  {step.icon}
                </div>
                <span className={cx('font-semibold', done ? 'text-white' : 'text-cinza-2')}>
                  {ORDER_STATUS_LABELS[step.status]}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <section className="mb-4 rounded-2xl border border-borda bg-preto-3 p-5">
        <h2 className="titulo-display mb-3 text-lg">Itens</h2>
        <ul className="space-y-2 text-sm">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span>
                <span className="text-amarelo">{item.quantity}×</span> {item.productName}
                {item.notes && <span className="block text-xs text-cinza-2">{item.notes}</span>}
              </span>
              <span className="shrink-0 text-cinza">{item.totalFormatted}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 border-t border-borda pt-4 text-sm">
          <Line label="Subtotal" value={formatBRL(order.subtotalCents)} />
          {order.deliveryFeeCents > 0 && (
            <Line label="Entrega" value={formatBRL(order.deliveryFeeCents)} />
          )}
          {order.discountCents > 0 && (
            <Line label="Desconto" value={`− ${formatBRL(order.discountCents)}`} accent />
          )}
          <div className="flex justify-between pt-2 font-bold">
            <dt>Total</dt>
            <dd className="titulo-display text-xl text-amarelo">{order.totalFormatted}</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-cinza-2">
          Pagamento:{' '}
          {PAYMENT_METHOD_LABELS[order.paymentMethod as PaymentMethod] ?? order.paymentMethod}
        </p>
      </section>

      {order.address && (
        <section className="mb-4 rounded-2xl border border-borda bg-preto-3 p-5">
          <h2 className="titulo-display mb-2 text-lg">Entrega</h2>
          <p className="text-sm text-cinza">
            {order.address.street}, {order.address.number}
            {order.address.complement && ` — ${order.address.complement}`}
            <br />
            {order.address.district} · {order.address.city}
            {order.address.reference && (
              <>
                <br />
                <span className="text-cinza-2">Ref.: {order.address.reference}</span>
              </>
            )}
          </p>
        </section>
      )}

      {canCancel && !showCancel && (
        <button
          type="button"
          onClick={() => setShowCancel(true)}
          className="w-full text-center text-sm text-cinza-2 underline transition-colors hover:text-vermelho-2"
        >
          Cancelar pedido
        </button>
      )}

      {showCancel && (
        <section className="rounded-2xl border border-vermelho/40 bg-vermelho/8 p-5">
          <h2 className="mb-3 font-bold">Cancelar pedido</h2>
          <Field
            label="Motivo"
            error={cancel.error instanceof ApiError ? cancel.error.detail : undefined}
          >
            <Input
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Pedi sem querer"
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              variant="fantasma"
              size="sm"
              onClick={() => setShowCancel(false)}
              disabled={cancel.isPending}
            >
              Voltar
            </Button>
            <Button
              size="sm"
              onClick={() => cancel.mutate(cancelReason)}
              loading={cancel.isPending}
              disabled={cancelReason.trim().length < 3}
            >
              Confirmar cancelamento
            </Button>
          </div>
        </section>
      )}

      <Link to="/" className="mt-8 block text-center text-sm text-cinza underline">
        Fazer outro pedido
      </Link>
    </div>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-cinza">{label}</dt>
      <dd className={accent ? 'text-verde' : 'text-cinza'}>{value}</dd>
    </div>
  );
}
