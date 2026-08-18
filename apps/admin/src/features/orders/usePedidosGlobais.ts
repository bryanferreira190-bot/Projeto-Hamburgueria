import { useQuery } from '@tanstack/react-query';
import { AdminRole, OrderStatus, hasRoleLevel } from '@adventure/shared';
import { api, type OrderRow } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/** Referencia estavel: um array novo a cada render dispararia efeitos a toa. */
const SEM_PEDIDOS: OrderRow[] = [];

/**
 * Colunas do painel de cozinha, na ordem em que o pedido caminha.
 *
 * Vive aqui (e nao em OrdersPage) porque tanto a pagina quanto o
 * indicador global da barra de navegacao precisam da mesma lista de
 * status "em andamento" — repetir a lista nos dois lugares divergiria
 * cedo ou tarde.
 */
export const COLUNAS: { status: OrderStatus; titulo: string; icone: string }[] = [
  { status: OrderStatus.PENDING_PAYMENT, titulo: 'Aguardando pagamento', icone: '⏳' },
  { status: OrderStatus.CONFIRMED, titulo: 'Novos', icone: '🔔' },
  { status: OrderStatus.PREPARING, titulo: 'Em preparo', icone: '👨‍🍳' },
  { status: OrderStatus.READY, titulo: 'Prontos', icone: '🍔' },
  { status: OrderStatus.OUT_FOR_DELIVERY, titulo: 'Saiu para entrega', icone: '🛵' },
  { status: OrderStatus.AWAITING_PICKUP, titulo: 'Aguardando retirada', icone: '🏪' },
];

/**
 * Pedidos em andamento, buscados no nivel do Layout (nao da pagina).
 *
 * Antes, esta consulta e o refetch de 15s so existiam enquanto
 * OrdersPage estava montada — sair para o Balcao ou o Cashback
 * derrubava o polling, o aviso sonoro parava e, ao voltar para
 * Pedidos, a tela mostrava o spinner de novo do zero (sem cache
 * quente). Como o Layout fica montado o tempo todo enquanto logado,
 * qualquer pagina reaproveita os MESMOS dados via a MESMA chave de
 * query — inclusive OrdersPage sem busca ativa, que nao dispara uma
 * segunda chamada para os mesmos dados.
 */
export function usePedidosGlobais() {
  const admin = useAuth((estado) => estado.admin);
  /* A rota exige KITCHEN+ do lado da API (ver OrdersController). DELIVERY
     e um papel valido no sistema mas nao enxerga pedido nenhum aqui — sem
     este `enabled`, um admin desse papel ficaria com uma chamada falhando
     de 15 em 15s em QUALQUER pagina, ja que o Layout busca isto sempre. */
  const podeVerPedidos = admin ? hasRoleLevel(admin.role, AdminRole.KITCHEN) : false;

  const query = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders({ limit: 100 }),
    refetchInterval: 15_000,
    enabled: podeVerPedidos,
  });

  const pedidos = query.data?.orders ?? SEM_PEDIDOS;
  const emAndamento = pedidos.filter((pedido) =>
    COLUNAS.some((coluna) => coluna.status === pedido.status),
  );

  return { ...query, pedidos, emAndamento };
}
