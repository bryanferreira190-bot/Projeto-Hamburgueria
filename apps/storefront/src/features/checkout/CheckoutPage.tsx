import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  PAYMENT_METHOD_LABELS,
  formatBRL,
  isCardPayment,
  isOnlinePayment,
  type PaymentMethod,
} from '@adventure/shared';
import { ApiError, api } from '../../lib/api';
import { useCart } from '../../stores/cart';
import { Button, EmptyState, Field, Input, Textarea } from '../../components/ui';
import { cx } from '../../lib/cx';
import { cartaoDisponivel } from '../../lib/mercadopago';
import { CamposDoCartao, type DadosDoCartao } from './CamposDoCartao';

type OrderType = 'DELIVERY' | 'PICKUP';

const PAYMENT_OPTIONS: { value: PaymentMethod; icon: string }[] = [
  { value: 'PIX', icon: '⚡' },
  { value: 'CREDIT_CARD', icon: '💳' },
  { value: 'CASH_ON_DELIVERY', icon: '💵' },
  { value: 'CARD_ON_DELIVERY', icon: '🏧' },
];

export function CheckoutPage() {
  const navigate = useNavigate();
  const { items, subtotalCents, clear } = useCart();

  const [type, setType] = useState<OrderType>('DELIVERY');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [district, setDistrict] = useState('');
  const [city, setCity] = useState('Itu');
  const [reference, setReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [changeFor, setChangeFor] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dadosDoCartao, setDadosDoCartao] = useState<DadosDoCartao | null>(null);
  const [tokenizando, setTokenizando] = useState(false);

  /**
   * Chave gerada uma vez por sessao de checkout. Enviada em todas as
   * tentativas de envio, para que dois cliques em "Confirmar" nao criem
   * dois pedidos.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const { data: status } = useQuery({ queryKey: ['store-status'], queryFn: api.getStoreStatus });

  /* Consulta a taxa assim que o bairro tem tamanho plausivel. */
  const { data: quote, isFetching: quoting } = useQuery({
    queryKey: ['delivery-quote', district],
    queryFn: () => api.quoteDelivery(district),
    enabled: type === 'DELIVERY' && district.trim().length >= 3,
    staleTime: 60_000,
  });

  const subtotal = subtotalCents();
  const deliveryFee = type === 'DELIVERY' ? (quote?.feeCents ?? 0) : 0;
  const estimatedTotal = subtotal + deliveryFee;

  const createOrder = useMutation({
    mutationFn: (payload: unknown) => api.createOrder(payload, idempotencyKey),
    onSuccess: (order) => {
      clear();
      void navigate(`/pedido/${order.number}`, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : 'Não foi possível enviar seu pedido.');
    },
  });

  useEffect(() => {
    if (type === 'PICKUP' && !status?.acceptsPickup) setType('DELIVERY');
  }, [type, status]);

  const missing = useMemo(() => {
    const list: string[] = [];
    if (name.trim().length < 2) list.push('nome');
    if (phone.replace(/\D/g, '').length < 11) list.push('telefone');
    if (type === 'DELIVERY') {
      if (zipCode.replace(/\D/g, '').length !== 8) list.push('CEP');
      if (street.trim().length < 2) list.push('rua');
      if (!number.trim()) list.push('número');
      if (district.trim().length < 2) list.push('bairro');
    }
    if (paymentMethod === 'CASH_ON_DELIVERY' && !changeFor.trim()) list.push('troco');
    /* PIX exige e-mail do pagador para o Mercado Pago gerar a cobranca —
       checagem leve aqui, a validacao de verdade e do servidor. */
    if (isOnlinePayment(paymentMethod) && !email.trim().includes('@')) list.push('e-mail');
    /* Os campos do cartao ficam em iframes do Mercado Pago e nao dao para
       validar daqui; o SDK recusa a tokenizacao se estiverem incompletos.
       So checamos o que e nosso. */
    if (isCardPayment(paymentMethod) && !dadosDoCartao) list.push('dados do cartão');
    return list;
  }, [
    name,
    phone,
    email,
    type,
    zipCode,
    street,
    number,
    district,
    paymentMethod,
    changeFor,
    dadosDoCartao,
  ]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon="🛒"
        title="Seu carrinho está vazio"
        description="Adicione itens ao carrinho antes de finalizar."
        action={
          <Link to="/">
            <Button variant="contorno">Ver cardápio</Button>
          </Link>
        }
      />
    );
  }

  const submit = async () => {
    setError(null);

    /**
     * O token do cartao e gerado agora, no envio, e nao enquanto a pessoa
     * digita: ele vale uma unica vez e expira, entao gerar antes correria
     * o risco de chegar velho na API se ela demorasse a concluir o resto
     * do formulario.
     */
    let card: { token: string; paymentMethodId: string; installments: number } | undefined;
    if (isCardPayment(paymentMethod)) {
      if (!dadosDoCartao) {
        setError('O formulário do cartão ainda não carregou. Aguarde um instante.');
        return;
      }
      setTokenizando(true);
      try {
        card = await dadosDoCartao.tokenizar();
      } catch {
        setTokenizando(false);
        setError('Confira os dados do cartão: número, validade, código de segurança e CPF.');
        return;
      }
      setTokenizando(false);
    }

    const payload = {
      type,
      customer: {
        name: name.trim(),
        phone: phone.replace(/\D/g, ''),
        ...(isOnlinePayment(paymentMethod) ? { email: email.trim() } : {}),
      },
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        /* "2x bacon" viaja como o id do bacon repetido duas vezes: a API
           cobra uma linha por id, entao repetir e como se pede mais de
           um do mesmo adicional. */
        optionIds: item.options.flatMap((option) =>
          Array.from({ length: option.quantity }, () => option.id),
        ),
        ...(item.notes ? { notes: item.notes } : {}),
      })),
      paymentMethod,
      ...(couponCode.trim() ? { couponCode: couponCode.trim().toUpperCase() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(paymentMethod === 'CASH_ON_DELIVERY'
        ? { changeForCents: Math.round(Number(changeFor.replace(',', '.')) * 100) }
        : {}),
      ...(card ? { card } : {}),
      ...(type === 'DELIVERY'
        ? {
            address: {
              zipCode: zipCode.replace(/\D/g, ''),
              street: street.trim(),
              number: number.trim(),
              district: district.trim(),
              city: city.trim(),
              state: 'SP',
              ...(complement.trim() ? { complement: complement.trim() } : {}),
              ...(reference.trim() ? { reference: reference.trim() } : {}),
            },
          }
        : {}),
    };

    createOrder.mutate(payload);
  };

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24">
      <h1 className="titulo-display py-8 text-3xl">
        FINALIZAR <span className="text-amarelo">PEDIDO</span>
      </h1>

      <div className="space-y-6">
        <Section title="Como você quer receber?">
          <div className="grid grid-cols-2 gap-3">
            <TypeCard
              icon="🛵"
              label="Entrega"
              description="Levamos até você"
              active={type === 'DELIVERY'}
              disabled={!status?.acceptsDelivery}
              onClick={() => setType('DELIVERY')}
            />
            <TypeCard
              icon="🏪"
              label="Retirada"
              description="Você busca na loja"
              active={type === 'PICKUP'}
              disabled={!status?.acceptsPickup}
              onClick={() => setType('PICKUP')}
            />
          </div>
        </Section>

        <Section title="Seus dados">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo" required>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Como podemos te chamar"
                autoComplete="name"
              />
            </Field>
            <Field label="WhatsApp" required hint="É por aqui que avisamos sobre o pedido">
              <Input
                value={phone}
                onChange={(event) => setPhone(formatPhone(event.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="tel"
                autoComplete="tel"
              />
            </Field>

            {isOnlinePayment(paymentMethod) && (
              <Field
                label="E-mail"
                required
                hint="Necessário para gerar a cobrança PIX"
                error={
                  email.trim().length > 0 && !email.trim().includes('@')
                    ? 'Informe um e-mail válido'
                    : undefined
                }
              >
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@email.com"
                  autoComplete="email"
                />
              </Field>
            )}
          </div>
        </Section>

        {type === 'DELIVERY' && (
          <Section title="Endereço de entrega">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="CEP" required>
                <Input
                  value={zipCode}
                  onChange={(event) => setZipCode(formatCep(event.target.value))}
                  placeholder="00000-000"
                  inputMode="numeric"
                  autoComplete="postal-code"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Rua" required>
                  <Input
                    value={street}
                    onChange={(event) => setStreet(event.target.value)}
                    placeholder="Nome da rua"
                    autoComplete="address-line1"
                  />
                </Field>
              </div>
              <Field label="Número" required>
                <Input
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  placeholder="123"
                />
              </Field>
              <Field label="Complemento">
                <Input
                  value={complement}
                  onChange={(event) => setComplement(event.target.value)}
                  placeholder="Apto, bloco"
                />
              </Field>
              <Field label="Bairro" required>
                <Input
                  value={district}
                  onChange={(event) => setDistrict(event.target.value)}
                  placeholder="Cidade Nova"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Cidade" required>
                  <Input value={city} onChange={(event) => setCity(event.target.value)} />
                </Field>
              </div>
              <Field label="Ponto de referência" hint="Ajuda muito o entregador a achar">
                <Input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Portão azul, ao lado da padaria"
                />
              </Field>
            </div>

            {quoting && <p className="mt-3 text-sm text-cinza">Calculando a taxa…</p>}
            {quote && !quoting && (
              <div
                className={cx(
                  'mt-3 rounded-xl border px-4 py-3 text-sm',
                  quote.available
                    ? 'border-verde/40 bg-verde/8 text-verde'
                    : 'border-vermelho/40 bg-vermelho/8 text-vermelho-2',
                )}
              >
                {quote.available ? (
                  <>
                    Taxa de entrega <strong>{quote.feeFormatted}</strong> · cerca de{' '}
                    {quote.etaMinutes} min
                  </>
                ) : (
                  quote.message
                )}
              </div>
            )}
          </Section>
        )}

        <Section title="Forma de pagamento">
          <div className="grid grid-cols-2 gap-3">
            {/* Cartao so aparece com a chave publica configurada — sem ela
                a tokenizacao nao roda, e oferecer a opcao criaria pedido
                que ninguem consegue pagar. */}
            {PAYMENT_OPTIONS.filter(
              (option) => cartaoDisponivel || !isCardPayment(option.value),
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPaymentMethod(option.value)}
                className={cx(
                  'flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all',
                  paymentMethod === option.value
                    ? 'border-amarelo bg-amarelo/10 text-amarelo'
                    : 'border-borda bg-preto-3 text-cinza hover:border-cinza-2',
                )}
              >
                <span className="text-xl" aria-hidden>
                  {option.icon}
                </span>
                {PAYMENT_METHOD_LABELS[option.value]}
              </button>
            ))}
          </div>

          {isCardPayment(paymentMethod) && (
            <div className="mt-5">
              <CamposDoCartao totalCents={estimatedTotal} aoMudar={setDadosDoCartao} />
            </div>
          )}

          {paymentMethod === 'CASH_ON_DELIVERY' && (
            <div className="mt-4">
              <Field label="Precisa de troco para quanto?" required>
                <Input
                  value={changeFor}
                  onChange={(event) => setChangeFor(event.target.value)}
                  placeholder="50,00"
                  inputMode="decimal"
                />
              </Field>
            </div>
          )}
        </Section>

        <Section title="Cupom e observações">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cupom de desconto">
              <Input
                value={couponCode}
                onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                placeholder="BEMVINDO10"
              />
            </Field>
            <Field label="Observações do pedido">
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Sem cebola, caprichar no molho…"
              />
            </Field>
          </div>
        </Section>

        <section className="rounded-2xl border border-borda bg-preto-3 p-5">
          <h2 className="titulo-display mb-4 text-lg">Resumo</h2>

          <ul className="mb-4 space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.lineId} className="flex justify-between gap-3">
                <span className="text-cinza">
                  {item.quantity}× {item.name}
                </span>
                <span>{formatBRL(item.unitPriceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-1.5 border-t border-borda pt-4 text-sm">
            <Row label="Subtotal" value={formatBRL(subtotal)} />
            {type === 'DELIVERY' && (
              <Row
                label="Taxa de entrega"
                value={quote ? quote.feeFormatted : 'informe o bairro'}
              />
            )}
            <div className="flex justify-between pt-2 text-base font-bold">
              <span>Total estimado</span>
              <span className="titulo-display text-2xl text-amarelo">
                {formatBRL(estimatedTotal)}
              </span>
            </div>
          </div>

          <p className="mt-2 text-xs text-cinza-2">
            O valor final é confirmado pelo servidor ao registrar o pedido, incluindo eventual
            desconto de cupom.
          </p>
        </section>

        {error && (
          <div className="rounded-xl border border-vermelho/40 bg-vermelho/10 px-4 py-3 text-sm text-vermelho-2">
            {error}
          </div>
        )}

        {missing.length > 0 && (
          <p className="text-center text-sm text-cinza-2">Falta preencher: {missing.join(', ')}.</p>
        )}

        <Button
          full
          size="lg"
          onClick={() => void submit()}
          loading={createOrder.isPending || tokenizando}
          disabled={missing.length > 0 || !status?.isOpen}
        >
          {status?.isOpen ? '🔥 Confirmar pedido' : 'Loja fechada no momento'}
        </Button>

        {!status?.isOpen && status && (
          <p className="text-center text-sm text-cinza-2">{status.message}</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-borda bg-preto-2 p-5">
      <h2 className="titulo-display mb-4 text-lg">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-cinza">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function TypeCard({
  icon,
  label,
  description,
  active,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  description: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'rounded-xl border p-4 text-left transition-all',
        active ? 'border-amarelo bg-amarelo/10' : 'border-borda bg-preto-3 hover:border-cinza-2',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span className="mb-1 block text-2xl" aria-hidden>
        {icon}
      </span>
      <span className={cx('block font-bold', active && 'text-amarelo')}>{label}</span>
      <span className="block text-xs text-cinza-2">{description}</span>
    </button>
  );
}

/* Mascaras apenas de exibicao; a API recebe somente digitos. */
function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
