import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_PLACEHOLDERS,
  NotificationEvent,
} from '@adventure/shared';
import { api, ApiError, type NotificationTemplateRow } from '../../lib/api';
import { Button, Card, Field, Input, Spinner, Switch, Textarea } from '../../components/ui';
import { cx } from '../../lib/cx';

/** Ordem de exibicao — a API devolve em ordem alfabetica do evento, que nao segue o ciclo de vida do pedido. */
const ORDEM_DOS_EVENTOS = Object.values(NotificationEvent);

export function WhatsAppSettingsPage() {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['notifications', 'status'],
    queryFn: api.notificationStatus,
    refetchInterval: 30_000,
  });

  const templates = useQuery({
    queryKey: ['notifications', 'templates'],
    queryFn: api.notificationTemplates,
  });

  const templatesOrdenados = templates.data
    ? [...templates.data].sort(
        (a, b) => ORDEM_DOS_EVENTOS.indexOf(a.event) - ORDEM_DOS_EVENTOS.indexOf(b.event),
      )
    : [];

  const invalidarTemplates = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications', 'templates'] });
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="titulo-display text-2xl">WhatsApp</h1>
        <p className="mt-1 text-sm text-cinza-2">
          Mensagens automáticas enviadas ao cliente conforme o pedido avança.
        </p>
      </header>

      <StatusCard status={status.data} carregando={status.isLoading} />

      <Card title="Mensagens por evento">
        {templates.isLoading ? (
          <Spinner label="Carregando templates" />
        ) : templates.isError ? (
          <p className="text-sm text-cinza">Não foi possível carregar os templates.</p>
        ) : (
          <div className="space-y-4">
            {templatesOrdenados.map((template) => (
              <TemplateRow key={template.id} template={template} onSalvo={invalidarTemplates} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Placeholders disponíveis">
        <dl className="grid gap-2.5 sm:grid-cols-2">
          {Object.entries(NOTIFICATION_PLACEHOLDERS).map(([placeholder, descricao]) => (
            <div key={placeholder} className="flex gap-2 text-sm">
              <dt className="shrink-0 font-mono font-bold text-amarelo">{placeholder}</dt>
              <dd className="text-cinza-2">{descricao}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <TesteCard provedorAtivo={status.data?.ativo ?? false} />
    </div>
  );
}

function StatusCard({
  status,
  carregando,
}: {
  status: { ativo: boolean; provider: string | null; conectado: boolean; detalhe?: string } | undefined;
  carregando: boolean;
}) {
  return (
    <Card title="Status da conexão">
      {carregando ? (
        <Spinner label="Verificando" />
      ) : !status ? (
        <p className="text-sm text-cinza">Não foi possível verificar o status.</p>
      ) : !status.ativo ? (
        <p className="text-sm text-cinza">
          <span aria-hidden>⚪</span> Envio automático desligado (
          <code className="text-xs">WHATSAPP_PROVIDER=none</code>). Nenhuma mensagem sai, pedido
          funciona normalmente.
        </p>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden>{status.conectado ? '🟢' : '🔴'}</span>
          <span className={cx('font-semibold', status.conectado ? 'text-bom' : 'text-critico')}>
            {status.conectado ? 'Conectado' : 'Desconectado'}
          </span>
          <span className="text-cinza-2">
            · provedor {status.provider}
            {status.detalhe ? ` · ${status.detalhe}` : ''}
          </span>
        </div>
      )}
    </Card>
  );
}

function TemplateRow({
  template,
  onSalvo,
}: {
  template: NotificationTemplateRow;
  onSalvo: () => void;
}) {
  const [texto, setTexto] = useState(template.message);
  const [erro, setErro] = useState<string | null>(null);

  const alterado = texto !== template.message;

  const salvar = useMutation({
    mutationFn: () => api.updateNotificationTemplate(template.event, { message: texto }),
    onSuccess: () => {
      setErro(null);
      onSalvo();
    },
    onError: (error) => setErro(error instanceof ApiError ? error.detail : 'Falha ao salvar.'),
  });

  const alternarAtivo = useMutation({
    mutationFn: () => api.updateNotificationTemplate(template.event, { isActive: !template.isActive }),
    onSuccess: onSalvo,
    onError: (error) => setErro(error instanceof ApiError ? error.detail : 'Falha ao alterar.'),
  });

  const restaurar = useMutation({
    mutationFn: () => api.restoreNotificationTemplate(template.event),
    onSuccess: (row) => {
      setTexto(row.message);
      setErro(null);
      onSalvo();
    },
    onError: (error) => setErro(error instanceof ApiError ? error.detail : 'Falha ao restaurar.'),
  });

  return (
    <div className="rounded-lg border border-borda p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="font-semibold">{NOTIFICATION_EVENT_LABELS[template.event]}</span>
        <Switch
          checked={template.isActive}
          onChange={() => alternarAtivo.mutate()}
          disabled={alternarAtivo.isPending}
          label={`Ativar/desativar ${NOTIFICATION_EVENT_LABELS[template.event]}`}
        />
      </div>

      <Textarea
        value={texto}
        onChange={(event) => setTexto(event.target.value)}
        rows={3}
        maxLength={1000}
        disabled={!template.isActive}
      />

      {erro && <p className="mt-1.5 text-xs text-vermelho-2">{erro}</p>}

      <div className="mt-2.5 flex items-center gap-2">
        <Button
          size="sm"
          variant="amarelo"
          disabled={!alterado || salvar.isPending}
          loading={salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar
        </Button>
        <Button
          size="sm"
          variant="contorno"
          disabled={restaurar.isPending}
          loading={restaurar.isPending}
          onClick={() => restaurar.mutate()}
        >
          Restaurar padrão
        </Button>
        {!template.isActive && (
          <span className="text-xs text-cinza-2">Desligado — este evento não envia mensagem</span>
        )}
      </div>
    </div>
  );
}

function TesteCard({ provedorAtivo }: { provedorAtivo: boolean }) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('Teste de integração 🍔');

  const enviar = useMutation({
    mutationFn: () => api.sendTestNotification(phone, message),
  });

  return (
    <Card title="Enviar teste">
      <p className="mb-3 text-sm text-cinza-2">
        {provedorAtivo
          ? 'Manda uma mensagem de verdade para o número informado.'
          : 'Envio automático está desligado — o teste só simula, nada é enviado de verdade.'}
      </p>

      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <Field label="Telefone">
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="11970706978"
          />
        </Field>
        <Field label="Mensagem">
          <Input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} />
        </Field>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={!phone.trim() || !message.trim() || enviar.isPending}
          loading={enviar.isPending}
          onClick={() => enviar.mutate()}
        >
          Enviar teste
        </Button>

        {enviar.isError && (
          <span className="text-xs text-vermelho-2">
            {enviar.error instanceof ApiError ? enviar.error.detail : 'Falha ao enviar.'}
          </span>
        )}
        {enviar.isSuccess && (
          <span className={cx('text-xs', enviar.data.enviado ? 'text-bom' : 'text-vermelho-2')}>
            {enviar.data.simulado
              ? 'Simulado (envio automático desligado).'
              : enviar.data.enviado
                ? 'Enviado com sucesso.'
                : `Falhou: ${enviar.data.motivo ?? 'motivo desconhecido'}`}
          </span>
        )}
      </div>
    </Card>
  );
}
