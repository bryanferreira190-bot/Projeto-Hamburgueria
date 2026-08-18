import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Card, Input, Spinner, Vazio } from '../../components/ui';
import { cx } from '../../lib/cx';
import { formatarTelefone, linkDoWhatsApp } from '../../lib/telefone';

/** Quantos dias antes do vencimento a linha ja aparece em alerta. */
const DIAS_DE_ALERTA = 3;

export function CashbackPage() {
  const [busca, setBusca] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cashback'],
    queryFn: api.cashback,
    staleTime: 60_000,
    /* Segunda tela ligada na cozinha: pedido muda de status na aba
       Pedidos (que ja invalida esta query), mas tambem cobre quem so
       tem esta aba aberta e nao vai mexer em pedido nenhuma. */
    refetchInterval: 30_000,
  });

  const visiveis = useMemo(() => {
    if (!data) return [];

    const termo = busca.trim().toLowerCase();
    if (!termo) return data.clientes;

    const digitos = termo.replace(/\D/g, '');
    return data.clientes.filter(
      (cliente) =>
        cliente.name?.toLowerCase().includes(termo) ||
        (digitos.length > 0 && cliente.phone.includes(digitos)),
    );
  }, [data, busca]);

  if (isLoading) return <Spinner label="Carregando cashback" />;

  if (isError || !data) {
    return (
      <Card>
        <p className="mb-3 text-center text-cinza">Não foi possível carregar o cashback.</p>
        <div className="flex justify-center">
          <Button variant="contorno" size="sm" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="titulo-display text-2xl">Cashback</h1>

        <Input
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="max-w-xs"
        />
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          titulo="Saldo em aberto"
          valor={data.totalEmAbertoFormatted}
          detalhe="Total que os clientes ainda podem usar"
          destaque
        />
        <Indicador
          titulo="Clientes com saldo"
          valor={String(data.clientesComSaldo)}
          detalhe="Quantos têm cashback válido agora"
        />
        <Indicador
          titulo={`Vence em ${DIAS_DE_ALERTA} dias`}
          valor={data.vencendoEmBreveFormatted}
          detalhe="Aviso automático sai 1 dia antes"
          alerta={data.vencendoEmBreveCents > 0}
        />
      </div>

      <Card title={`Clientes (${visiveis.length})`}>
        {visiveis.length === 0 ? (
          <Vazio
            icon="💰"
            title={busca ? 'Nenhum cliente encontrado' : 'Ninguém tem cashback ainda'}
            description={
              busca
                ? 'Tente outro nome ou telefone.'
                : 'O saldo aparece aqui assim que o primeiro pedido entrar em preparo.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-borda text-left text-xs text-cinza-2 uppercase">
                  <th className="pb-2 font-semibold">Cliente</th>
                  <th className="pb-2 font-semibold">WhatsApp</th>
                  <th className="pb-2 font-semibold">Vence em</th>
                  <th className="pb-2 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((cliente) => (
                  <tr key={cliente.customerId} className="border-b border-borda/50">
                    <td className="py-2.5 font-semibold">{cliente.name ?? 'Sem nome'}</td>
                    <td className="py-2.5">
                      <a
                        href={linkDoWhatsApp(cliente.phone)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-verde hover:underline"
                      >
                        {formatarTelefone(cliente.phone)}
                      </a>
                    </td>
                    <td className="py-2.5">
                      <Vencimento iso={cliente.proximoVencimento} />
                    </td>
                    <td className="tabular py-2.5 text-right font-bold text-amarelo">
                      {cliente.saldoFormatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Indicador({
  titulo,
  valor,
  detalhe,
  destaque,
  alerta,
}: {
  titulo: string;
  valor: string;
  detalhe: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-xl border bg-preto-2 p-4',
        alerta ? 'border-amarelo/40' : 'border-borda',
      )}
    >
      <p className="text-xs text-cinza-2">{titulo}</p>
      <p
        className={cx(
          'titulo-display mt-1 text-2xl',
          destaque || alerta ? 'text-amarelo' : 'text-white',
        )}
      >
        {valor}
      </p>
      <p className="mt-1 text-xs text-cinza-2">{detalhe}</p>
    </div>
  );
}

/**
 * Mostra a data e, quando esta perto, quantos dias faltam — quem olha a
 * tela quer decidir se vale a pena chamar o cliente, e "em 2 dias" responde
 * isso mais rapido que uma data solta.
 */
function Vencimento({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-cinza-2">—</span>;

  const data = new Date(iso);
  const dias = Math.ceil((data.getTime() - Date.now()) / 86_400_000);
  const perto = dias <= DIAS_DE_ALERTA;

  return (
    <span className={perto ? 'font-semibold text-amarelo' : 'text-cinza'}>
      {data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
      {perto && (
        <span className="ml-1 text-xs">
          ({dias <= 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`})
        </span>
      )}
    </span>
  );
}
