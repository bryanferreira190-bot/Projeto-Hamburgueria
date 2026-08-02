import { describe, expect, it, vi } from 'vitest';
import { OrderPricingService } from './order-pricing.service';
import type { Prisma } from '@prisma/client';

/**
 * Estas regras decidem quanto o cliente paga. Um erro aqui e dinheiro
 * perdido ou cobranca indevida — por isso a cobertura detalhada.
 */

const CLASSIC = {
  id: 'p1',
  name: 'Classic Burguer',
  priceCents: 2800,
  isActive: true,
  isAvailable: true,
  optionGroups: [],
};

const COM_ADICIONAIS = {
  id: 'p2',
  name: 'Monte o seu',
  priceCents: 3000,
  isActive: true,
  isAvailable: true,
  optionGroups: [
    {
      optionGroup: {
        id: 'g1',
        name: 'Ponto da carne',
        minSelect: 1,
        maxSelect: 1,
        isActive: true,
        options: [
          { id: 'o1', name: 'Ao ponto', priceCents: 0, isActive: true },
          { id: 'o2', name: 'Bem passado', priceCents: 0, isActive: true },
        ],
      },
    },
    {
      optionGroup: {
        id: 'g2',
        name: 'Extras',
        minSelect: 0,
        maxSelect: 2,
        isActive: true,
        options: [
          { id: 'o3', name: 'Bacon extra', priceCents: 600, isActive: true },
          { id: 'o4', name: 'Cheddar extra', priceCents: 400, isActive: true },
        ],
      },
    },
  ],
};

function makeTx(products: unknown[], coupon: unknown = null) {
  return {
    product: { findMany: vi.fn().mockResolvedValue(products) },
    coupon: { findFirst: vi.fn().mockResolvedValue(coupon) },
  } as unknown as Prisma.TransactionClient;
}

const service = new OrderPricingService();

describe('calculo de itens', () => {
  it('usa o preco do banco, nunca o enviado pelo cliente', async () => {
    const tx = makeTx([CLASSIC]);
    const result = await service.price(tx, {
      storeId: 's1',
      items: [{ productId: 'p1', quantity: 2, optionIds: [] }],
      deliveryFeeCents: 0,
    });

    expect(result.subtotalCents).toBe(5600);
    expect(result.items[0]?.unitPriceCents).toBe(2800);
  });

  it('soma os adicionais por unidade antes de multiplicar', async () => {
    const tx = makeTx([COM_ADICIONAIS]);
    const result = await service.price(tx, {
      storeId: 's1',
      items: [{ productId: 'p2', quantity: 2, optionIds: ['o1', 'o3'] }],
      deliveryFeeCents: 0,
    });

    /* (3000 + 0 + 600) * 2 */
    expect(result.subtotalCents).toBe(7200);
  });

  it('recusa produto indisponivel', async () => {
    const tx = makeTx([{ ...CLASSIC, isAvailable: false }]);
    await expect(
      service.price(tx, {
        storeId: 's1',
        items: [{ productId: 'p1', quantity: 1, optionIds: [] }],
        deliveryFeeCents: 0,
      }),
    ).rejects.toThrow(/indisponivel/i);
  });

  it('recusa produto que nao existe', async () => {
    const tx = makeTx([]);
    await expect(
      service.price(tx, {
        storeId: 's1',
        items: [{ productId: 'fantasma', quantity: 1, optionIds: [] }],
        deliveryFeeCents: 0,
      }),
    ).rejects.toThrow(/indisponivel no cardapio/i);
  });
});

describe('validacao de adicionais', () => {
  it('recusa adicional que nao pertence ao produto', async () => {
    const tx = makeTx([COM_ADICIONAIS]);
    await expect(
      service.price(tx, {
        storeId: 's1',
        items: [{ productId: 'p2', quantity: 1, optionIds: ['o1', 'adicional-de-outro-produto'] }],
        deliveryFeeCents: 0,
      }),
    ).rejects.toThrow(/Adicional invalido/i);
  });

  it('exige a escolha minima do grupo obrigatorio', async () => {
    const tx = makeTx([COM_ADICIONAIS]);
    await expect(
      service.price(tx, {
        storeId: 's1',
        items: [{ productId: 'p2', quantity: 1, optionIds: [] }],
        deliveryFeeCents: 0,
      }),
    ).rejects.toThrow(/exige ao menos 1/i);
  });

  it('respeita o maximo de escolhas do grupo', async () => {
    const tx = makeTx([COM_ADICIONAIS]);
    await expect(
      service.price(tx, {
        storeId: 's1',
        items: [{ productId: 'p2', quantity: 1, optionIds: ['o1', 'o2'] }],
        deliveryFeeCents: 0,
      }),
    ).rejects.toThrow(/no maximo 1/i);
  });
});

describe('cupons', () => {
  const cupomBase = {
    id: 'c1',
    code: 'TESTE',
    discountType: 'PERCENT' as const,
    discountValue: 10,
    maxDiscountCents: null,
    minOrderCents: 0,
    usageLimit: null,
    usageCount: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
  };

  const pedido = (coupon: unknown) =>
    service.price(makeTx([CLASSIC], coupon), {
      storeId: 's1',
      items: [{ productId: 'p1', quantity: 1, optionIds: [] }],
      deliveryFeeCents: 500,
      couponCode: 'TESTE',
    });

  it('aplica desconto percentual', async () => {
    const result = await pedido(cupomBase);
    expect(result.discountCents).toBe(280);
    /* Desconto incide so nos produtos; a entrega permanece integral. */
    expect(result.totalCents).toBe(2800 - 280 + 500);
  });

  it('respeita o teto de desconto', async () => {
    const result = await pedido({ ...cupomBase, discountValue: 50, maxDiscountCents: 500 });
    expect(result.discountCents).toBe(500);
  });

  it('nunca deixa o desconto passar do subtotal', async () => {
    const result = await pedido({
      ...cupomBase,
      discountType: 'FIXED',
      discountValue: 999_999,
    });
    expect(result.discountCents).toBe(2800);
    expect(result.totalCents).toBe(500);
  });

  it('recusa cupom expirado', async () => {
    await expect(pedido({ ...cupomBase, endsAt: new Date('2020-01-01') })).rejects.toThrow(
      /expirou/i,
    );
  });

  it('recusa cupom que ainda nao comecou', async () => {
    await expect(pedido({ ...cupomBase, startsAt: new Date('2099-01-01') })).rejects.toThrow(
      /ainda nao esta valendo/i,
    );
  });

  it('recusa cupom que atingiu o limite', async () => {
    await expect(pedido({ ...cupomBase, usageLimit: 10, usageCount: 10 })).rejects.toThrow(
      /limite de uso/i,
    );
  });

  it('recusa cupom abaixo do pedido minimo', async () => {
    await expect(pedido({ ...cupomBase, minOrderCents: 10_000 })).rejects.toThrow(/a partir de/i);
  });

  it('recusa cupom inexistente', async () => {
    await expect(pedido(null)).rejects.toThrow(/invalido/i);
  });

  it('sem cupom, desconto e zero', async () => {
    const result = await service.price(makeTx([CLASSIC]), {
      storeId: 's1',
      items: [{ productId: 'p1', quantity: 1, optionIds: [] }],
      deliveryFeeCents: 500,
    });
    expect(result.discountCents).toBe(0);
    expect(result.couponId).toBeNull();
  });
});
