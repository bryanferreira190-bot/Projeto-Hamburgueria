import { BadRequestException, Injectable } from '@nestjs/common';
import {
  applyPercentDiscount,
  multiplyCents,
  sumCents,
  type Cents,
  type OrderItemInput,
} from '@adventure/shared';
import type { Prisma } from '@prisma/client';

export interface PricedOptionRow {
  optionId: string;
  optionName: string;
  priceCents: Cents;
}

export interface PricedItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: Cents;
  optionsPriceCents: Cents;
  totalCents: Cents;
  notes?: string | undefined;
  options: PricedOptionRow[];
}

export interface PricedOrder {
  items: PricedItem[];
  subtotalCents: Cents;
  deliveryFeeCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
  couponId: string | null;
}

interface CouponRow {
  id: string;
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: number;
  maxDiscountCents: number | null;
  minOrderCents: number;
  usageLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

/**
 * CALCULO DE VALORES — AUTORIDADE UNICA
 *
 * Todo valor cobrado nasce aqui, a partir do que esta no banco. Nenhum preco
 * enviado pelo cliente e considerado, nem para conferencia.
 *
 * Roda dentro da transacao de criacao do pedido, para que preco, cupom e
 * disponibilidade sejam lidos no mesmo instante em que o pedido e gravado.
 */
@Injectable()
export class OrderPricingService {
  async price(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      items: OrderItemInput[];
      deliveryFeeCents: Cents;
      couponCode?: string | undefined;
    },
  ): Promise<PricedOrder> {
    const items = await this.priceItems(tx, params.storeId, params.items);
    const subtotalCents = sumCents(items.map((item) => item.totalCents));

    const { discountCents, couponId } = await this.applyCoupon(
      tx,
      params.storeId,
      subtotalCents,
      params.couponCode,
    );

    /* O desconto incide sobre os produtos, nunca sobre a taxa de entrega:
       o entregador recebe integralmente. */
    const totalCents = subtotalCents - discountCents + params.deliveryFeeCents;

    return {
      items,
      subtotalCents,
      deliveryFeeCents: params.deliveryFeeCents,
      discountCents,
      totalCents,
      couponId,
    };
  }

  private async priceItems(
    tx: Prisma.TransactionClient,
    storeId: string,
    inputs: OrderItemInput[],
  ): Promise<PricedItem[]> {
    const productIds = [...new Set(inputs.map((item) => item.productId))];

    const products = await tx.product.findMany({
      where: { id: { in: productIds }, storeId, deletedAt: null },
      include: {
        optionGroups: {
          include: { optionGroup: { include: { options: true } } },
        },
      },
    });

    const productById = new Map(products.map((product) => [product.id, product]));

    /* Produto que nao existe mais no cardapio da erro antes de cobrar. */
    const missing = productIds.filter((id) => !productById.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Produto indisponivel no cardapio: ${missing.join(', ')}`);
    }

    return inputs.map((input) => {
      const product = productById.get(input.productId)!;

      if (!product.isActive || !product.isAvailable) {
        throw new BadRequestException(`"${product.name}" esta indisponivel no momento.`);
      }

      const options = this.resolveOptions(product, input.optionIds);
      const optionsPriceCents = sumCents(options.map((option) => option.priceCents));

      return {
        productId: product.id,
        productName: product.name,
        quantity: input.quantity,
        /* Preco COPIADO do banco no instante do pedido. */
        unitPriceCents: product.priceCents,
        optionsPriceCents,
        totalCents: multiplyCents(product.priceCents + optionsPriceCents, input.quantity),
        notes: input.notes,
        options,
      };
    });
  }

  /**
   * Valida que cada adicional pertence a um grupo do proprio produto e que as
   * quantidades minima e maxima de cada grupo foram respeitadas.
   *
   * Sem esta checagem, daria para anexar ao pedido o id de um adicional de
   * outro produto — ou de um mais barato — e pagar menos.
   */
  private resolveOptions(
    product: {
      name: string;
      optionGroups: {
        optionGroup: {
          id: string;
          name: string;
          minSelect: number;
          maxSelect: number;
          isActive: boolean;
          options: { id: string; name: string; priceCents: number; isActive: boolean }[];
        };
      }[];
    },
    optionIds: string[],
  ): PricedOptionRow[] {
    const groups = product.optionGroups.map((link) => link.optionGroup).filter((g) => g.isActive);

    const allowedOptions = new Map(
      groups.flatMap((group) =>
        group.options.filter((option) => option.isActive).map((option) => [option.id, { option, group }]),
      ),
    );

    const unknown = optionIds.filter((id) => !allowedOptions.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Adicional invalido para "${product.name}": ${unknown.join(', ')}`,
      );
    }

    const chosenByGroup = new Map<string, number>();
    for (const id of optionIds) {
      const groupId = allowedOptions.get(id)!.group.id;
      chosenByGroup.set(groupId, (chosenByGroup.get(groupId) ?? 0) + 1);
    }

    for (const group of groups) {
      const chosen = chosenByGroup.get(group.id) ?? 0;
      if (chosen < group.minSelect) {
        throw new BadRequestException(
          `"${group.name}" exige ao menos ${group.minSelect} escolha(s) em "${product.name}".`,
        );
      }
      if (chosen > group.maxSelect) {
        throw new BadRequestException(
          `"${group.name}" permite no maximo ${group.maxSelect} escolha(s) em "${product.name}".`,
        );
      }
    }

    return optionIds.map((id) => {
      const { option } = allowedOptions.get(id)!;
      return { optionId: option.id, optionName: option.name, priceCents: option.priceCents };
    });
  }

  private async applyCoupon(
    tx: Prisma.TransactionClient,
    storeId: string,
    subtotalCents: Cents,
    code?: string,
  ): Promise<{ discountCents: Cents; couponId: string | null }> {
    if (!code) return { discountCents: 0, couponId: null };

    const coupon = (await tx.coupon.findFirst({
      where: { storeId, code },
    })) as CouponRow | null;

    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('Cupom invalido.');
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException('Este cupom ainda nao esta valendo.');
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      throw new BadRequestException('Este cupom expirou.');
    }
    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      throw new BadRequestException('Este cupom atingiu o limite de uso.');
    }
    if (subtotalCents < coupon.minOrderCents) {
      throw new BadRequestException(
        `Este cupom vale para pedidos a partir de ${(coupon.minOrderCents / 100).toFixed(2)}.`,
      );
    }

    const discount =
      coupon.discountType === 'PERCENT'
        ? subtotalCents - applyPercentDiscount(subtotalCents, coupon.discountValue)
        : coupon.discountValue;

    const capped = coupon.maxDiscountCents
      ? Math.min(discount, coupon.maxDiscountCents)
      : discount;

    /* Nunca deixar o desconto ultrapassar o subtotal: o total do pedido
       jamais pode ficar negativo. */
    return { discountCents: Math.min(capped, subtotalCents), couponId: coupon.id };
  }
}
