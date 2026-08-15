import { useEffect, useRef } from 'react';
import { OrderStatus } from '@adventure/shared';
import type { OrderRow } from '../../lib/api';
import { tocarAvisoDePedido } from '../../lib/som';

/** Colunas em que um pedido aparece recem-chegado e precisa chamar atencao. */
const STATUS_QUE_AVISAM: string[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED];

/**
 * Toca o aviso quando um pedido novo entra em "Aguardando pagamento" ou
 * "Novos".
 *
 * Compara por id, e nao por quantidade: a fila tambem encolhe (pedido
 * avanca para "Em preparo", pedido e cancelado), entao contar levaria a
 * avisos errados nos dois sentidos.
 */
export function useAvisoDePedidoNovo(pedidos: OrderRow[], ativo: boolean, pausado: boolean) {
  /* null = ainda nao houve a primeira carga. Distinguir isso de "fila
     vazia" importa: sem essa diferenca, abrir o painel com pedidos ja na
     fila tocaria o aviso para cada um, como se tivessem acabado de
     chegar. */
  const conhecidos = useRef<Set<string> | null>(null);

  useEffect(() => {
    /**
     * Pausa em duas situacoes, pelo mesmo motivo de fundo — a lista na
     * mao nao representa a fila real, e memorizar aqui geraria aviso
     * errado depois:
     *
     * - ainda carregando: a lista vazia viraria a linha de base, e todo
     *   pedido ja existente contaria como recem-chegado quando os dados
     *   chegassem;
     * - busca ativa: e um recorte, entao os pedidos fora do filtro
     *   pareceriam ter sumido e "chegado de novo" ao limpar a busca.
     */
    if (pausado) return;

    const naFila = new Set(
      pedidos.filter((pedido) => STATUS_QUE_AVISAM.includes(pedido.status)).map((p) => p.id),
    );

    const anteriores = conhecidos.current;
    conhecidos.current = naFila;
    if (anteriores === null) return;

    const chegouPedidoNovo = [...naFila].some((id) => !anteriores.has(id));
    if (chegouPedidoNovo && ativo) void tocarAvisoDePedido();
  }, [pedidos, ativo, pausado]);
}
