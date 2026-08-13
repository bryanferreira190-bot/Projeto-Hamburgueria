import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { multiplyCents, sumCents } from '@adventure/shared';
import type { Product } from '../lib/api';

/** Adicional escolhido, com o preco copiado no momento da escolha. */
export interface CartOption {
  id: string;
  name: string;
  priceCents: number;
}

export interface CartItem {
  /** Identificador da linha do carrinho, nao do produto. */
  lineId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  options: CartOption[];
  notes?: string;
}

/** O que a caixa de escolha devolve ao confirmar. */
export interface EscolhaDoItem {
  quantity?: number;
  options?: CartOption[];
  notes?: string;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;

  add: (product: Product, escolha?: EscolhaDoItem) => void;
  remove: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  clear: () => void;

  open: () => void;
  close: () => void;
  toggle: () => void;

  /** Preco de uma unidade da linha, ja com os adicionais. */
  unitTotalCents: (item: CartItem) => number;
  subtotalCents: () => number;
  totalItems: () => number;
}

/**
 * Duas linhas so podem se fundir quando sao o MESMO pedido: mesmo produto,
 * mesmos adicionais e mesma observacao. Sem isso, pedir um Classic com
 * bacon e outro sem bacon viraria "Classic x2" e a cozinha perderia a
 * diferenca.
 */
function assinatura(productId: string, options: CartOption[], notes?: string): string {
  const ids = options
    .map((option) => option.id)
    .sort()
    .join(',');
  return `${productId}|${ids}|${notes?.trim() ?? ''}`;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      /**
       * Somar na linha existente, em vez de criar outra, evita "Classic
       * Burguer x1" repetido tres vezes no carrinho — mas so quando os
       * adicionais e a observacao sao iguais (ver assinatura()).
       */
      add: (product, escolha = {}) =>
        set((state) => {
          const quantity = escolha.quantity ?? 1;
          const options = escolha.options ?? [];
          const notes = escolha.notes?.trim() || undefined;

          const chave = assinatura(product.id, options, notes);
          const existing = state.items.find(
            (item) => assinatura(item.productId, item.options, item.notes) === chave,
          );

          if (existing) {
            return {
              items: state.items.map((item) =>
                item.lineId === existing.lineId
                  ? { ...item, quantity: item.quantity + quantity }
                  : item,
              ),
            };
          }

          return {
            items: [
              ...state.items,
              {
                lineId: crypto.randomUUID(),
                productId: product.id,
                name: product.name,
                imageUrl: product.imageUrl,
                unitPriceCents: product.priceCents,
                quantity,
                options,
                ...(notes ? { notes } : {}),
              },
            ],
          };
        }),

      remove: (lineId) =>
        set((state) => ({ items: state.items.filter((item) => item.lineId !== lineId) })),

      /* Quantidade zero remove a linha, comportamento esperado nos botoes -/+ */
      setQuantity: (lineId, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((item) => item.lineId !== lineId)
              : state.items.map((item) => (item.lineId === lineId ? { ...item, quantity } : item)),
        })),

      clear: () => set({ items: [] }),

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),

      unitTotalCents: (item) =>
        item.unitPriceCents + sumCents(item.options.map((option) => option.priceCents)),

      /**
       * Valor apenas para EXIBICAO. O total cobrado e sempre recalculado
       * pelo servidor no momento do pedido — inclusive o preco de cada
       * adicional, que vem do banco e nao daqui.
       */
      subtotalCents: () =>
        sumCents(
          get().items.map((item) =>
            multiplyCents(get().unitTotalCents(item), item.quantity),
          ),
        ),

      totalItems: () => get().items.reduce((total, item) => total + item.quantity, 0),
    }),
    {
      name: 'adventure-carrinho',
      /* Só o conteudo do carrinho persiste; o estado de aberto/fechado nao. */
      partialize: (state) => ({ items: state.items }) as CartState,

      /**
       * Carrinhos salvos antes dos adicionais nao tem o campo "options".
       * Sem esta migracao, quem tinha item no carrinho abriria a loja e
       * veria tela branca no primeiro subtotalCents() — options.map() em
       * undefined. A versao sobe junto para a migracao rodar uma vez so.
       */
      version: 1,
      migrate: (estadoSalvo, versaoAnterior) => {
        const estado = estadoSalvo as { items?: CartItem[] } | undefined;
        if (!estado?.items) return estado as CartState;

        if (versaoAnterior < 1) {
          estado.items = estado.items.map((item) => ({ ...item, options: item.options ?? [] }));
        }

        return estado as CartState;
      },
    },
  ),
);
