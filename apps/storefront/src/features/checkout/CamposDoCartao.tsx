import { useEffect, useRef, useState } from 'react';
import { formatBRL } from '@adventure/shared';
import { Field, Input } from '../../components/ui';
import { cx } from '../../lib/cx';
import { obterMercadoPago, type OpcaoDeParcelamento } from '../../lib/mercadopago';

/**
 * O que o checkout precisa devolver para a API quando o pagamento e no
 * cartao. Montado aqui e entregue via `aoMudar`.
 */
export interface DadosDoCartao {
  /** Gera o token na hora do envio — ele vale uma vez so. */
  tokenizar: () => Promise<{ token: string; paymentMethodId: string; installments: number }>;
  pronto: boolean;
}

/** Estilo dos campos que o Mercado Pago desenha dentro dos iframes. */
const ESTILO_DO_CAMPO = {
  color: '#ffffff',
  'font-size': '16px',
  'font-family': 'Inter, sans-serif',
  placeholderColor: '#6f6f6f',
};

const CAIXA =
  'w-full rounded-xl border border-borda bg-preto-3 px-4 py-3 transition-colors focus-within:border-amarelo';

export function CamposDoCartao({
  totalCents,
  aoMudar,
}: {
  totalCents: number;
  aoMudar: (dados: DadosDoCartao | null) => void;
}) {
  const [nomeNoCartao, setNomeNoCartao] = useState('');
  const [cpf, setCpf] = useState('');
  const [parcelas, setParcelas] = useState(1);
  const [opcoesDeParcela, setOpcoesDeParcela] = useState<OpcaoDeParcelamento[]>([]);
  const [bandeira, setBandeira] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  /* Guardados em ref porque o tokenizar() precisa deles no momento do
     envio, sem recriar a funcao (e remontar os campos) a cada tecla. */
  const refNome = useRef(nomeNoCartao);
  const refCpf = useRef(cpf);
  const refParcelas = useRef(parcelas);
  const refBandeira = useRef<string | null>(null);
  refNome.current = nomeNoCartao;
  refCpf.current = cpf;
  refParcelas.current = parcelas;
  refBandeira.current = bandeira;

  /* Monta os campos seguros uma unica vez. O array vazio e proposital:
     remontar iframe a cada render apagaria o que a pessoa digitou. */
  useEffect(() => {
    let vivo = true;
    const desmontar: (() => void)[] = [];

    void (async () => {
      try {
        const mp = await obterMercadoPago();
        if (!vivo) return;

        const numero = mp.fields
          .create('cardNumber', { placeholder: '0000 0000 0000 0000', style: ESTILO_DO_CAMPO })
          .mount('mp-numero-do-cartao');
        const validade = mp.fields
          .create('expirationDate', { placeholder: 'MM/AA', style: ESTILO_DO_CAMPO })
          .mount('mp-validade');
        const cvv = mp.fields
          .create('securityCode', { placeholder: '123', style: ESTILO_DO_CAMPO })
          .mount('mp-cvv');

        desmontar.push(
          () => numero.unmount(),
          () => validade.unmount(),
          () => cvv.unmount(),
        );

        /* O BIN sao os primeiros digitos: com ele o Mercado Pago diz qual
           e a bandeira e quantas parcelas o cartao aceita. */
        numero.on('binChange', (dados) => {
          void (async () => {
            if (!dados.bin) {
              setBandeira(null);
              setOpcoesDeParcela([]);
              return;
            }
            try {
              const metodos = await mp.getPaymentMethods({ bin: dados.bin });
              const metodo = metodos.results[0];
              if (!metodo || !vivo) return;
              setBandeira(metodo.id);

              const parcelamento = await mp.getInstallments({
                amount: (totalCents / 100).toFixed(2),
                bin: dados.bin,
                paymentTypeId: metodo.payment_type_id,
              });
              if (vivo) setOpcoesDeParcela(parcelamento[0]?.payer_costs ?? []);
            } catch {
              /* Falha ao consultar bandeira nao impede o pagamento: o
                 servidor valida de novo na hora de cobrar. */
            }
          })();
        });

        setCarregando(false);

        aoMudar({
          pronto: true,
          tokenizar: async () => {
            const { id } = await mp.fields.createCardToken({
              cardholderName: refNome.current.trim(),
              identificationType: 'CPF',
              identificationNumber: refCpf.current.replace(/\D/g, ''),
            });
            return {
              token: id,
              paymentMethodId: refBandeira.current ?? '',
              installments: refParcelas.current,
            };
          },
        });
      } catch (falha) {
        if (!vivo) return;
        setCarregando(false);
        setErro(
          falha instanceof Error && falha.message.includes('nao configurada')
            ? 'Pagamento com cartão indisponível no momento.'
            : 'Não foi possível carregar o formulário do cartão. Recarregue a página.',
        );
        aoMudar(null);
      }
    })();

    return () => {
      vivo = false;
      for (const fn of desmontar) {
        try {
          fn();
        } catch {
          /* Iframe ja removido do DOM — nao ha o que desfazer. */
        }
      }
      aoMudar(null);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- montagem unica de proposito */
  }, []);

  if (erro) {
    return (
      <p className="rounded-xl border border-vermelho/40 bg-vermelho/10 px-4 py-3 text-sm text-vermelho-2">
        {erro}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {carregando && <p className="text-sm text-cinza">Carregando formulário seguro…</p>}

      <div className={cx('space-y-4', carregando && 'hidden')}>
        <Field label="Número do cartão" required>
          {/* Cada caixa abaixo recebe um iframe do Mercado Pago: os dados
              do cartao nunca entram no HTML da loja. */}
          <div id="mp-numero-do-cartao" className={cx(CAIXA, 'h-12')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Validade" required>
            <div id="mp-validade" className={cx(CAIXA, 'h-12')} />
          </Field>
          <Field label="Código de segurança" required>
            <div id="mp-cvv" className={cx(CAIXA, 'h-12')} />
          </Field>
        </div>

        <Field label="Nome impresso no cartão" required>
          <Input
            value={nomeNoCartao}
            onChange={(e) => setNomeNoCartao(e.target.value.toUpperCase())}
            placeholder="COMO ESTA NO CARTAO"
            autoComplete="cc-name"
          />
        </Field>

        <Field label="CPF do titular" required>
          <Input
            value={cpf}
            onChange={(e) => setCpf(formatarCpf(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
          />
        </Field>

        {opcoesDeParcela.length > 0 && (
          <Field label="Parcelamento">
            <select
              value={parcelas}
              onChange={(e) => setParcelas(Number(e.target.value))}
              className="w-full rounded-xl border border-borda bg-preto-3 px-4 py-3 text-white transition-colors focus:border-amarelo focus:outline-none"
            >
              {opcoesDeParcela.map((opcao) => (
                <option key={opcao.installments} value={opcao.installments}>
                  {opcao.recommended_message}
                </option>
              ))}
            </select>
          </Field>
        )}

        {opcoesDeParcela.length === 0 && (
          <p className="text-xs text-cinza-2">
            Total: <span className="font-bold text-amarelo">{formatBRL(totalCents)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** 000.000.000-00 conforme digita. */
function formatarCpf(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  return digitos
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
