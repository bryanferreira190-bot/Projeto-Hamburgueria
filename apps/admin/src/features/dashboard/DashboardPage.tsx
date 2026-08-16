import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { formatBRL, type KpiComparison } from '@adventure/shared';
import { ApiError, api } from '../../lib/api';
import { Button, Card, Spinner } from '../../components/ui';
import { cx } from '../../lib/cx';
import {
  GraficoFaturamento,
  GraficoPagamentos,
  GraficoPorHora,
  GraficoTopProdutos,
} from './charts';

const PERIODOS = [
  { label: 'Hoje', dias: 0 },
  { label: '7 dias', dias: 7 },
  { label: '30 dias', dias: 30 },
  { label: '90 dias', dias: 90 },
] as const;

export function DashboardPage() {
  const [dias, setDias] = useState<number>(30);
  const [exportando, setExportando] = useState(false);
  const [erroExport, setErroExport] = useState<string | null>(null);

  const { from, to } = calcularPeriodo(dias);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', dias],
    queryFn: () => api.dashboard(from, to),
    refetchInterval: 60_000,
  });

  async function exportarCsv() {
    setErroExport(null);
    setExportando(true);
    try {
      await api.exportCsv(from, to);
    } catch (error) {
      setErroExport(error instanceof ApiError ? error.detail : 'Não foi possível baixar o CSV.');
    } finally {
      setExportando(false);
    }
  }

  if (isLoading) return <Spinner label="Carregando indicadores" />;

  if (isError || !data) {
    return (
      <Card>
        <p className="mb-3 text-center text-cinza">Não foi possível carregar os indicadores.</p>
        <div className="flex justify-center">
          <Button variant="contorno" size="sm" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      </Card>
    );
  }

  const { kpis } = data;

  return (
    <div className="space-y-5">
      {/* Filtros em uma linha unica acima dos graficos. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="titulo-display text-2xl">Visão geral</h1>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-borda bg-preto-2 p-1">
            {PERIODOS.map((periodo) => (
              <button
                key={periodo.label}
                type="button"
                onClick={() => setDias(periodo.dias)}
                className={cx(
                  'rounded-md px-3 py-1.5 text-xs font-bold transition-colors',
                  dias === periodo.dias ? 'bg-amarelo text-preto' : 'text-cinza hover:text-white',
                )}
              >
                {periodo.label}
              </button>
            ))}
          </div>

          <Button
            variant="contorno"
            size="sm"
            loading={exportando}
            onClick={() => void exportarCsv()}
          >
            ⬇ CSV
          </Button>
        </div>
      </header>

      {erroExport && (
        <p role="alert" className="text-sm text-vermelho-2">
          {erroExport}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi titulo="Faturamento" dado={kpis.revenueCents} formatar={formatBRL} destaque />
        <Kpi titulo="Pedidos" dado={kpis.ordersCount} formatar={(v) => String(v)} />
        <Kpi titulo="Ticket médio" dado={kpis.avgTicketCents} formatar={formatBRL} />
        <CardCancelamento quantidade={kpis.canceledCount} percentual={kpis.cancelRatePercent} />
      </div>

      <Card title="Faturamento por dia">
        <GraficoFaturamento dados={data.revenueByDay} />
      </Card>

      {/* items-start impede que o card da esquerda estique para acompanhar
          a altura da coluna da direita, o que deixaria um vazio enorme
          quando ha poucos produtos. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Produtos mais vendidos">
          <GraficoTopProdutos dados={data.topProducts} />
        </Card>

        <div className="space-y-4">
          <Card title="Movimento por hora">
            <GraficoPorHora dados={data.byHour} />
          </Card>

          <Card title="Formas de pagamento">
            <GraficoPagamentos dados={data.byPaymentMethod} />
          </Card>
        </div>
      </div>

      <Card title="Entrega x Retirada">
        <div className="grid grid-cols-2 gap-4">
          <ResumoTipo icone="🛵" rotulo="Entrega" valor={data.byType.delivery} />
          <ResumoTipo icone="🏪" rotulo="Retirada" valor={data.byType.pickup} />
        </div>
      </Card>
    </div>
  );
}

function Kpi({
  titulo,
  dado,
  formatar,
  destaque,
}: {
  titulo: string;
  dado: KpiComparison;
  formatar: (valor: number) => string;
  destaque?: boolean;
}) {
  return (
    <Card>
      <p className="mb-1 text-xs font-bold tracking-wider text-cinza-2 uppercase">{titulo}</p>
      <p className={cx('titulo-display text-3xl', destaque ? 'text-amarelo' : 'text-white')}>
        {formatar(dado.value)}
      </p>
      <Variacao percentual={dado.changePercent} />
    </Card>
  );
}

/**
 * A variacao usa cor de STATUS (nunca cor de serie) e vem sempre acompanhada
 * de seta e texto — a informacao nunca depende so da cor.
 */
function Variacao({ percentual }: { percentual: number | null }) {
  if (percentual === null) {
    return <p className="mt-1 text-xs text-cinza-2">sem base de comparação</p>;
  }

  const subiu = percentual >= 0;

  return (
    <p className={cx('mt-1 text-xs font-semibold', subiu ? 'text-[#0ca30c]' : 'text-[#d03b3b]')}>
      <span aria-hidden>{subiu ? '▲' : '▼'}</span> {Math.abs(percentual).toFixed(1)}%
      <span className="ml-1 font-normal text-cinza-2">vs. período anterior</span>
    </p>
  );
}

function CardCancelamento({ quantidade, percentual }: { quantidade: number; percentual: number }) {
  /* Acima de 10% de cancelamento e sinal de problema operacional. */
  const preocupante = percentual > 10;

  return (
    <Card>
      <p className="mb-1 text-xs font-bold tracking-wider text-cinza-2 uppercase">Cancelamentos</p>
      <p className="titulo-display text-3xl">{quantidade}</p>
      <p
        className={cx(
          'mt-1 text-xs font-semibold',
          preocupante ? 'text-[#d03b3b]' : 'text-cinza-2',
        )}
      >
        {preocupante && <span aria-hidden>⚠ </span>}
        {percentual.toFixed(1)}% dos pedidos
      </p>
    </Card>
  );
}

function ResumoTipo({ icone, rotulo, valor }: { icone: string; rotulo: string; valor: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-borda bg-preto-3 p-4">
      <span className="text-2xl" aria-hidden>
        {icone}
      </span>
      <div>
        <p className="titulo-display text-2xl">{valor}</p>
        <p className="text-xs text-cinza-2">{rotulo}</p>
      </div>
    </div>
  );
}

function calcularPeriodo(dias: number): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();

  if (dias === 0) {
    from.setHours(0, 0, 0, 0);
  } else {
    from.setDate(from.getDate() - dias);
  }

  return { from, to };
}
