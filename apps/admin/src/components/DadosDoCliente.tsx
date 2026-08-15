import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  PAYMENT_METHOD_LABELS,
  formatBRL,
  isOnlinePayment,
  type PaymentMethod,
} from '@adventure/shared';
import { nomeDoCliente, type OrderRow } from '../lib/api';
import { cx } from '../lib/cx';
import { formatarTelefone, linkDoWhatsApp } from '../lib/telefone';

const LARGURA = 272;
/** Folga entre a ficha e o gatilho, e da ficha ate a borda da tela. */
const FOLGA = 8;

/**
 * Ficha do cliente, aberta a partir do numero do pedido ou do nome.
 *
 * Abre ao passar o mouse (computador) e tambem no toque (tablet na
 * cozinha, onde "passar o mouse" nao existe). O toque/clique FIXA a ficha
 * aberta, senao nao daria tempo de mirar no link do WhatsApp antes de ela
 * sumir.
 *
 * Renderizada por portal, com posicao fixa calculada na abertura, porque
 * a tabela do historico vive dentro de um `overflow-x-auto` — que
 * recortaria qualquer caixa posicionada de forma absoluta dentro dela.
 */
export function DadosDoCliente({ pedido, children }: { pedido: OrderRow; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [fixado, setFixado] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  const gatilho = useRef<HTMLButtonElement>(null);
  const ficha = useRef<HTMLDivElement>(null);
  /* Fechar tem um atraso curto para o mouse conseguir atravessar o vao
     entre o gatilho e a ficha sem que ela feche no meio do caminho. */
  const fechamento = useRef<number | null>(null);

  function abrir() {
    if (fechamento.current) window.clearTimeout(fechamento.current);
    setAberto(true);
  }

  function fecharEmBreve() {
    if (fixado) return;
    fechamento.current = window.setTimeout(() => setAberto(false), 120);
  }

  function fecharAgora() {
    if (fechamento.current) window.clearTimeout(fechamento.current);
    setFixado(false);
    setAberto(false);
  }

  useEffect(() => () => window.clearTimeout(fechamento.current ?? undefined), []);

  /* Posicao acompanha o gatilho enquanto a ficha estiver aberta: com
     `position: fixed`, rolar a pagina deixaria a ficha parada no ar. */
  useEffect(() => {
    if (!aberto) return;

    function posicionar() {
      const alvo = gatilho.current?.getBoundingClientRect();
      if (!alvo) return;

      setPosicao({
        top: alvo.bottom + FOLGA,
        /* Segura a ficha dentro da tela quando o gatilho esta na coluna
           mais a direita do quadro. */
        left: Math.max(FOLGA, Math.min(alvo.left, window.innerWidth - LARGURA - FOLGA)),
      });
    }

    posicionar();
    /* Captura para pegar tambem a rolagem de containers internos. */
    window.addEventListener('scroll', posicionar, true);
    window.addEventListener('resize', posicionar);
    return () => {
      window.removeEventListener('scroll', posicionar, true);
      window.removeEventListener('resize', posicionar);
    };
  }, [aberto]);

  useEffect(() => {
    if (!fixado) return;

    function aoClicarFora(evento: MouseEvent) {
      const alvo = evento.target as Node;
      if (!gatilho.current?.contains(alvo) && !ficha.current?.contains(alvo)) fecharAgora();
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') fecharAgora();
    }

    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [fixado]);

  return (
    <>
      <button
        ref={gatilho}
        type="button"
        aria-expanded={aberto}
        aria-haspopup="dialog"
        onMouseEnter={abrir}
        onMouseLeave={fecharEmBreve}
        onFocus={abrir}
        onBlur={fecharEmBreve}
        onClick={() => {
          if (fixado) fecharAgora();
          else {
            setFixado(true);
            abrir();
          }
        }}
        className={cx(
          'rounded text-left underline decoration-cinza-2 decoration-dotted underline-offset-4',
          'hover:decoration-amarelo focus-visible:outline-2 focus-visible:outline-amarelo',
        )}
      >
        {children}
      </button>

      {aberto &&
        posicao &&
        createPortal(
          <div
            ref={ficha}
            role="dialog"
            aria-label={`Dados de ${nomeDoCliente(pedido) ?? 'cliente sem nome'}`}
            onMouseEnter={abrir}
            onMouseLeave={fecharEmBreve}
            style={{ top: posicao.top, left: posicao.left, width: LARGURA }}
            className="fixed z-50 space-y-2.5 rounded-xl border border-borda bg-preto-3 p-3 text-left shadow-2xl"
          >
            <Cabecalho pedido={pedido} />
            {/* Pedido de balcao pode nao ter cliente cadastrado — sem
                telefone nao ha conversa para abrir. */}
            {pedido.customer ? (
              <BotaoDoWhatsApp pedido={pedido} telefone={pedido.customer.phone} />
            ) : (
              <p className="rounded-lg border border-borda bg-carvao px-2.5 py-2 text-xs text-cinza-2">
                Pedido de balcão sem telefone — chame pelo número {pedido.number}.
              </p>
            )}
            {pedido.address && <Endereco endereco={pedido.address} />}
            <Pagamento pedido={pedido} />
            {pedido.notes && (
              <p className="rounded bg-carvao px-2 py-1 text-xs text-cinza italic">
                Obs.: {pedido.notes}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function Cabecalho({ pedido }: { pedido: OrderRow }) {
  const quando = new Date(pedido.createdAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div>
      <p className="text-sm font-bold text-white">{nomeDoCliente(pedido) ?? 'Sem nome'}</p>
      <p className="text-xs text-cinza-2">
        Pedido {pedido.number} ·{' '}
        {pedido.isManual ? '🧾 Balcão' : pedido.type === 'DELIVERY' ? '🛵 Entrega' : '🏪 Retirada'}{' '}
        · {quando}
      </p>
    </div>
  );
}

/**
 * Abre a conversa ja identificando o pedido: quem atende nao precisa
 * digitar nem lembrar o numero, que e justamente o que a pessoa do outro
 * lado precisa ouvir primeiro para saber do que se trata.
 */
function BotaoDoWhatsApp({ pedido, telefone }: { pedido: OrderRow; telefone: string }) {
  const mensagem = `Ola! Aqui e da Adventure Burguer, sobre o seu pedido ${pedido.number}.`;

  return (
    <a
      href={linkDoWhatsApp(telefone, mensagem)}
      target="_blank"
      rel="noreferrer"
      className={cx(
        'flex items-center gap-2 rounded-lg border border-verde/40 bg-verde/10 px-2.5 py-2',
        'text-sm font-bold text-verde transition-colors hover:bg-verde/20',
      )}
    >
      <span aria-hidden>💬</span>
      {formatarTelefone(telefone)}
    </a>
  );
}

function Endereco({ endereco }: { endereco: NonNullable<OrderRow['address']> }) {
  return (
    <div className="text-xs text-cinza">
      <p className="mb-0.5 font-semibold text-cinza-2">Endereço</p>
      <p>
        {endereco.street}, {endereco.number}
        {endereco.complement && ` — ${endereco.complement}`}
      </p>
      <p>
        {endereco.district}
        {endereco.city && ` · ${endereco.city}`}
        {endereco.state && `/${endereco.state}`}
      </p>
      {endereco.reference && <p className="italic">Referência: {endereco.reference}</p>}
    </div>
  );
}

function Pagamento({ pedido }: { pedido: OrderRow }) {
  const naEntrega = !isOnlinePayment(pedido.paymentMethod as PaymentMethod);

  return (
    <div className="text-xs">
      <p className="mb-0.5 font-semibold text-cinza-2">Pagamento</p>
      <p className={cx('font-semibold', naEntrega ? 'text-amarelo' : 'text-cinza')}>
        {PAYMENT_METHOD_LABELS[pedido.paymentMethod as PaymentMethod] ?? pedido.paymentMethod}
        {naEntrega && ' — cobrar na entrega'}
      </p>
      {pedido.changeForCents !== null && (
        <p className="text-cinza">Troco para {formatBRL(pedido.changeForCents)}</p>
      )}
      <p className="mt-1 font-bold text-white">Total {pedido.totalFormatted}</p>
    </div>
  );
}
