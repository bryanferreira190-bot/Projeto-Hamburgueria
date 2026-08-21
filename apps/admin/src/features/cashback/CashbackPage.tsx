import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { AdminRole, NotificationEvent, hasRoleLevel } from '@adventure/shared';
import { api, ApiError, type ResultadoEmMassa } from '../../lib/api';
import { Button, Card, Input, Spinner, Textarea, Vazio } from '../../components/ui';
import { cx } from '../../lib/cx';
import { useAuth } from '../../lib/auth';
import { formatarTelefone, linkDoWhatsApp } from '../../lib/telefone';

/** Quantos dias antes do vencimento a linha ja aparece em alerta. */
const DIAS_DE_ALERTA = 3;

export function CashbackPage() {
  const { admin } = useAuth();
  const [busca, setBusca] = useState('');
  const [mostrarDisparo, setMostrarDisparo] = useState(false);

  /* Disparo em massa manda pra todo mundo com saldo de uma vez —
     mesmo nivel de acesso das outras acoes de WhatsApp (teste, editar
     template), so OWNER. */
  const isOwner = admin ? hasRoleLevel(admin.role, AdminRole.OWNER) : false;

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

        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="max-w-xs"
          />
          {isOwner && data.clientesComSaldo > 0 && (
            <Button variant="contorno" size="sm" onClick={() => setMostrarDisparo(true)}>
              📣 Disparar mensagem
            </Button>
          )}
        </div>
      </header>

      {mostrarDisparo && (
        <DispararCashbackModal
          totalClientes={data.clientesComSaldo}
          onFechar={() => setMostrarDisparo(false)}
        />
      )}

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

/**
 * Disparo manual do MESMO lembrete que o job diario manda sozinho no
 * dia seguinte ao pedido (ver CashbackReminderJob no backend) — so que
 * na hora que o dono quiser, para todo cliente com saldo AGORA, com
 * previa editavel antes de confirmar.
 */
function DispararCashbackModal({
  totalClientes,
  onFechar,
}: {
  totalClientes: number;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);

  const { data: templates, isLoading: carregandoTemplate } = useQuery({
    queryKey: ['notifications', 'templates'],
    queryFn: api.notificationTemplates,
  });

  /* So preenche uma vez, quando o template chega — depois disso o
     admin pode editar livremente sem o valor voltar a ser sobrescrito. */
  useEffect(() => {
    if (texto !== null || !templates) return;
    const padrao = templates.find((template) => template.event === NotificationEvent.CASHBACK_REMINDER);
    setTexto(padrao?.message ?? '');
  }, [templates, texto]);

  const disparar = useMutation({
    mutationFn: () => api.dispararCashback((texto ?? '').trim()),
  });

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-5"
      onClick={onFechar}
    >
      <div
        role="dialog"
        aria-label="Disparar mensagem de cashback"
        onClick={(evento) => evento.stopPropagation()}
        className="w-full max-w-lg rounded-t-2xl border border-borda bg-preto-2 p-5 sm:rounded-2xl"
      >
        <header className="mb-4">
          <h2 className="titulo-display text-lg">Disparar lembrete de cashback</h2>
          <p className="mt-1 text-xs text-cinza-2">
            Manda a mensagem abaixo, agora, para os <strong>{totalClientes}</strong> cliente
            {totalClientes === 1 ? '' : 's'} com saldo de cashback.
          </p>
        </header>

        <div className="mb-4 rounded-xl border border-amarelo/40 bg-amarelo/8 px-3 py-2.5 text-xs text-amarelo">
          ⚠️ Recomendado usar no máximo <strong>1 vez por dia</strong> — mandar de novo em seguida
          reenvia para quem já recebeu.
        </div>

        {carregandoTemplate || texto === null ? (
          <Spinner label="Carregando mensagem" />
        ) : disparar.isSuccess ? (
          <ResultadoDoDisparo resultado={disparar.data} onFechar={onFechar} />
        ) : (
          <>
            <label className="mb-1.5 block text-xs font-bold text-cinza-2">
              Mensagem (prévia editável)
            </label>
            <Textarea
              autoFocus
              rows={7}
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              maxLength={1000}
            />
            <p className="mt-1.5 text-xs text-cinza-2">
              Placeholders aceitos: <code>{'{nome}'}</code> e <code>{'{cashback}'}</code>.
            </p>

            {disparar.isError && (
              <p className="mt-2 text-xs text-vermelho-2">
                {disparar.error instanceof ApiError ? disparar.error.detail : 'Falha ao disparar.'}
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="contorno" full onClick={onFechar} disabled={disparar.isPending}>
                Cancelar
              </Button>
              <Button
                variant="amarelo"
                full
                disabled={!texto.trim() || disparar.isPending}
                loading={disparar.isPending}
                onClick={() => disparar.mutate()}
              >
                Enviar para {totalClientes}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResultadoDoDisparo({
  resultado,
  onFechar,
}: {
  resultado: ResultadoEmMassa;
  onFechar: () => void;
}) {
  return (
    <div>
      <div className="rounded-xl border border-verde/40 bg-verde/8 p-4 text-sm">
        <p className="font-bold text-verde">
          {resultado.enviados} de {resultado.total} mensagem{resultado.total === 1 ? '' : 's'} enviada
          {resultado.enviados === 1 ? '' : 's'}.
        </p>
        {resultado.falhas > 0 && (
          <p className="mt-1 text-cinza">{resultado.falhas} falharam (ver logs do servidor).</p>
        )}
        {resultado.simulados > 0 && (
          <p className="mt-1 text-cinza">
            {resultado.simulados} simulada{resultado.simulados === 1 ? '' : 's'} — envio automático
            está desligado (nada foi enviado de verdade).
          </p>
        )}
      </div>

      <Button variant="contorno" full className="mt-5" onClick={onFechar}>
        Fechar
      </Button>
    </div>
  );
}
