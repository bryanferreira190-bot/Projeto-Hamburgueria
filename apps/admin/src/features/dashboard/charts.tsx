import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PAYMENT_METHOD_LABELS, formatBRL, type PaymentMethod } from '@adventure/shared';
import type { DashboardData } from '@adventure/shared';

/**
 * CORES DAS SERIES
 *
 * Paleta categorica validada para a superficie #0a0a0a: todos os cinco
 * checks passam, pior par adjacente sob daltonismo ΔE 16.0 (alvo >= 8).
 * A ordem e o mecanismo de seguranca — nao reordene sem revalidar.
 */
const SERIES = ['#c98500', '#3987e5', '#199e70', '#9085e9', '#d55181'] as const;

/* Cromo recessivo: grade e eixos nao competem com os dados. */
const GRADE = '#2c2c2a';
const TINTA_MUDA = '#898781';
const SUPERFICIE = '#171717';

const eixoBase = {
  stroke: GRADE,
  tick: { fill: TINTA_MUDA, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

/** Tooltip unico para todos os graficos, garantindo leitura consistente. */
function Dica({
  active,
  payload,
  label,
  formatar,
}: {
  active?: boolean;
  payload?: {
    value: number;
    name?: string;
    payload?: Record<string, unknown>;
  }[];
  label?: string | number;
  formatar: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-borda bg-preto px-3 py-2 text-xs shadow-xl">
      {label !== undefined && <p className="mb-1 font-semibold text-white">{label}</p>}
      {payload.map((item, index) => (
        <p key={index} className="tabular text-cinza">
          {formatar(item.value)}
        </p>
      ))}
    </div>
  );
}

/* ==================== Faturamento por dia ==================== */

export function GraficoFaturamento({ dados }: { dados: DashboardData['revenueByDay'] }) {
  if (dados.length === 0) return <SemDados />;

  const pontos = dados.map((dia) => ({
    dia: new Date(`${dia.date}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    }),
    reais: dia.revenueCents / 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="gradFaturamento" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
          </linearGradient>
        </defs>

        <XAxis dataKey="dia" {...eixoBase} />
        <YAxis
          {...eixoBase}
          width={54}
          tickFormatter={(valor: number) => `R$${Math.round(valor)}`}
        />
        <Tooltip
          cursor={{ stroke: TINTA_MUDA, strokeWidth: 1 }}
          content={<Dica formatar={(v) => formatBRL(Math.round(v * 100))} />}
        />

        {/* Serie unica: sem legenda, o titulo do card ja nomeia o dado. */}
        <Area
          type="monotone"
          dataKey="reais"
          stroke={SERIES[0]}
          strokeWidth={2}
          fill="url(#gradFaturamento)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: SUPERFICIE }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ==================== Produtos mais vendidos ==================== */

export function GraficoTopProdutos({ dados }: { dados: DashboardData['topProducts'] }) {
  if (dados.length === 0) return <SemDados />;

  const pontos = dados.slice(0, 8).map((produto) => ({
    nome: produto.name.length > 22 ? `${produto.name.slice(0, 21)}…` : produto.name,
    quantidade: produto.quantity,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, pontos.length * 36)}>
      <BarChart data={pontos} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="nome"
          {...eixoBase}
          width={150}
          tick={{ fill: '#c3c2b7', fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,.04)' }}
          content={<Dica formatar={(v) => `${v} unidade${v === 1 ? '' : 's'}`} />}
        />

        {/* Categorico nominal: todas as barras na MESMA cor. Colorir por
            valor gastaria o canal de identidade para repetir o que o
            comprimento da barra ja mostra. */}
        <Bar dataKey="quantidade" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ==================== Movimento por hora ==================== */

export function GraficoPorHora({ dados }: { dados: DashboardData['byHour'] }) {
  /* Corta as horas mortas das pontas, mas mantem os buracos internos —
     um vale real precisa aparecer como vale. */
  const comMovimento = dados.filter((h) => h.ordersCount > 0);
  if (comMovimento.length === 0) return <SemDados />;

  const primeira = Math.max(0, (comMovimento[0]?.hour ?? 0) - 1);
  const ultima = Math.min(23, (comMovimento.at(-1)?.hour ?? 23) + 1);

  const pontos = dados
    .filter((h) => h.hour >= primeira && h.hour <= ultima)
    .map((h) => ({
      hora: `${String(h.hour).padStart(2, '0')}h`,
      pedidos: h.ordersCount,
    }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={pontos} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <XAxis dataKey="hora" {...eixoBase} />
        <YAxis {...eixoBase} width={32} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,.04)' }}
          content={<Dica formatar={(v) => `${v} pedido${v === 1 ? '' : 's'}`} />}
        />
        <Bar dataKey="pedidos" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ==================== Formas de pagamento ==================== */

export function GraficoPagamentos({ dados }: { dados: DashboardData['byPaymentMethod'] }) {
  if (dados.length === 0) return <SemDados />;

  const total = dados.reduce((soma, item) => soma + item.revenueCents, 0);

  const pontos = dados.map((item, index) => ({
    nome: PAYMENT_METHOD_LABELS[item.method as PaymentMethod] ?? item.method,
    valor: item.revenueCents,
    cor: SERIES[index % SERIES.length]!,
    percentual: total === 0 ? 0 : Math.round((item.revenueCents / total) * 100),
  }));

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <ResponsiveContainer width="100%" height={180} className="max-w-[180px]">
        <PieChart>
          <Pie
            data={pontos}
            dataKey="valor"
            nameKey="nome"
            innerRadius={48}
            outerRadius={78}
            paddingAngle={2}
            strokeWidth={2}
            stroke={SUPERFICIE}
          >
            {pontos.map((ponto) => (
              <Cell key={ponto.nome} fill={ponto.cor} />
            ))}
          </Pie>
          <Tooltip content={<Dica formatar={(v) => formatBRL(v)} />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Legenda obrigatoria com 2+ series: a identidade nunca fica so na cor. */}
      <ul className="flex-1 space-y-2 text-sm">
        {pontos.map((ponto) => (
          <li key={ponto.nome} className="flex items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: ponto.cor }}
              aria-hidden
            />
            <span className="flex-1 truncate text-cinza">{ponto.nome}</span>
            <span className="tabular shrink-0 font-semibold">{ponto.percentual}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SemDados() {
  return (
    <div className="grid h-40 place-items-center text-sm text-cinza-2">
      Nenhum dado no período selecionado.
    </div>
  );
}
