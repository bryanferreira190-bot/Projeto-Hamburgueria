import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { multiplyCents, sumCents } from '@adventure/shared';
import type { Product } from '../lib/api';

export interface CartItem {
  /** Identificador da linha do carrinho, nao do produto. */
  lineId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  notes?: string;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;

  add: (product: Product, quantity?: number) => void;
  remove: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  setNotes: (lineId: string, notes: string) => void;
  clear: () => void;

  open: () => void;
  close: () => void;
  toggle: () => void;

  subtotalCents: () => number;
  totalItems: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      /**
       * Somar o mesmo produto na linha existente, em vez de criar outra,
       * evita "Classic Burguer x1" repetido tres vezes no carrinho.
       */
      add: (product, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((item) => item.productId === product.id);

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

      setNotes: (lineId, notes) =>
        set((state) => ({
          items: state.items.map((item) => (item.lineId === lineId ? { ...item, notes } : item)),
        })),

      clear: () => set({ items: [] }),

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),

      /**
       * Valor apenas para EXIBICAO. O total cobrado e sempre recalculado
       * pelo servidor no momento do pedido.
       */
      subtotalCents: () =>
        sumCents(get().items.map((item) => multiplyCents(item.unitPriceCents, item.quantity))),

      totalItems: () => get().items.reduce((total, item) => total + item.quantity, 0),
    }),
    {
      name: 'adventure-carrinho',
      /* Só o conteudo do carrinho persiste; o estado de aberto/fechado nao. */
      partialize: (state) => ({ items: state.items }) as CartState,
    },
  ),
);
