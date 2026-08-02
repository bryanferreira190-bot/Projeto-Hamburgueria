import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  OrderType,
  assertTransition,
  canCustomerCancel,
  formatBRL,
  isOnlinePayment,
  isTerminalStatus,
  type CreateOrderInput,
  type ListOrdersFilter,
} from '@adventure/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DeliveryService } from '../delivery/delivery.service';
import { StoreService } from '../store/store.service';
import { OrderPricingService } from './order-pricing.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: OrderPricingService,
    private readonly store: StoreService,
    private readonly delivery: DeliveryService,
  ) {}

  /**
   * CRIACAO DE PEDIDO
   *
   * Tudo acontece em uma transacao: ou o pedido nasce completo, com itens,
   * adicionais e historico, ou nada e gravado. Um pedido pela metade na
   * cozinha e pior do que pedido nenhum.
   */
  async create(input: CreateOrderInput, idempotencyKey?: string) {
    const store = await this.prisma.store.findFirst();
    if (!store) throw new NotFoundException('Loja nao configurada');

    /* Idempotencia: dois cliques em "Finalizar" nao podem virar dois pedidos. */
    if (idempotencyKey) {
      const existing = await this.prisma.order.findFirst({
        where: { storeId: store.id, idempotencyKey },
      });
      if (existing) {
        this.logger.log(`Pedido ${existing.number} devolvido por idempotencia`);
        return this.findById(existing.id);
      }
    }

    /* A loja precisa estar aberta AGORA, segundo o servidor. */
    const status = await this.store.getStatus();
    if (!status.isOpen) {
      throw new BadRequestException(status.message);
    }

    if (input.type === OrderType.DELIVERY && !store.acceptsDelivery) {
      throw new BadRequestException('No momento estamos atendendo apenas retirada.');
    }
    if (input.type === OrderType.PICKUP && !store.acceptsPickup) {
      throw new BadRequestException('No momento estamos atendendo apenas entrega.');
    }

    const quote =
      input.type === OrderType.DELIVERY ? await this.delivery.quote(input.address.district) : null;

    if (quote && !quote.available) {
      throw new BadRequestException(quote.message);
    }

    const deliveryFeeCents = quote?.feeCents ?? 0;

    const order = await this.prisma.$transaction(async (tx) => {
      const priced = await this.pricing.price(tx, {
        storeId: store.id,
        items: input.items,
        deliveryFeeCents,
        couponCode: input.couponCode,
      });

      const minOrder = quote?.minOrderCents ?? store.minOrderCents;
      if (priced.subtotalCents < minOrder) {
        throw new BadRequestException(`O pedido minimo e de ${formatBRL(minOrder)}.`);
      }

      /* Troco precisa cobrir o total; caso contrario o entregador fica sem. */
      if (input.changeForCents !== undefined && input.changeForCents < priced.totalCents) {
        throw new BadRequestException(
          `O valor para troco (${formatBRL(input.changeForCents)}) e menor que o total (${formatBRL(priced.totalCents)}).`,
        );
      }

      const customer = await tx.customer.upsert({
        where: { storeId_phone: { storeId: store.id, phone: input.customer.phone } },
        update: { name: input.customer.name, lastOrderAt: new Date() },
        create: {
          storeId: store.id,
          phone: input.customer.phone,
          name: input.customer.name,
          lastOrderAt: new Date(),
        },
      });

      /* Pagamento online nasce aguardando confirmacao do provedor; na
         entrega, o pedido ja entra confirmado para a cozinha. */
      const initialStatus = isOnlinePayment(input.paymentMethod)
        ? OrderStatus.PENDING_PAYMENT
        : OrderStatus.CONFIRMED;

      const created = await tx.order.create({
        data: {
          storeId: store.id,
          number: await this.nextOrderNumber(tx, store.id),
          customerId: customer.id,
          couponId: priced.couponId,
          type: input.type,
          status: initialStatus,
          subtotalCents: priced.subtotalCents,
          deliveryFeeCents: priced.deliveryFeeCents,
          discountCents: priced.discountCents,
          totalCents: priced.totalCents,
          paymentMethod: input.paymentMethod,
          changeForCents: input.changeForCents ?? null,
          notes: input.notes ?? null,
          idempotencyKey: idempotencyKey ?? null,
          confirmedAt: initialStatus === OrderStatus.CONFIRMED ? new Date() : null,

          /* Endereco COPIADO: editar o endereco depois nao pode reescrever
             para onde esta entrega foi. */
          ...(input.type === OrderType.DELIVERY
            ? {
                addressZipCode: input.address.zipCode,
                addressStreet: input.address.street,
                addressNumber: input.address.number,
                addressComplement: input.address.complement ?? null,
                addressDistrict: input.address.district,
                addressCity: input.address.city,
                addressState: input.address.state,
                addressReference: input.address.reference ?? null,
              }
            : {}),

          items: {
            create: priced.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              optionsPriceCents: item.optionsPriceCents,
              totalCents: item.totalCents,
              notes: item.notes ?? null,
              options: {
                create: item.options.map((option) => ({
                  optionId: option.optionId,
                  optionName: option.optionName,
                  priceCents: option.priceCents,
                })),
              },
            })),
          },

          statusHistory: {
            create: { toStatus: initialStatus, reason: 'Pedido criado' },
          },
        },
      });

      if (priced.couponId) {
        await tx.coupon.update({
          where: { id: priced.couponId },
          data: { usageCount: { increment: 1 } },
        });
      }

      return created;
    });

    this.logger.log(`Pedido ${order.number} criado — ${formatBRL(order.totalCents)}`);
    return this.findById(order.id);
  }

  async findById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { options: true } },
        customer: { select: { name: true, phone: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) throw new NotFoundException('Pedido nao encontrado');
    return toOrderDto(order);
  }

  /** Consulta publica pelo numero curto, para o cliente acompanhar. */
  async findByNumber(number: string) {
    const store = await this.prisma.store.findFirst({ select: { id: true } });
    if (!store) throw new NotFoundException('Loja nao configurada');

    const order = await this.prisma.order.findFirst({
      where: { storeId: store.id, number: number.toUpperCase() },
      include: {
        items: { include: { options: true } },
        customer: { select: { name: true, phone: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) throw new NotFoundException('Pedido nao encontrado');
    return toOrderDto(order);
  }

  /** Listagem administrativa, com paginacao por cursor. */
  async list(filter: ListOrdersFilter) {
    const where: Prisma.OrderWhereInput = {
      ...(filter.status ? { status: { in: filter.status } } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.search
        ? {
            OR: [
              { number: { contains: filter.search.toUpperCase() } },
              { customer: { name: { contains: filter.search, mode: 'insensitive' } } },
              { customer: { phone: { contains: filter.search.replace(/\D/g, '') } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: {
        items: { include: { options: true } },
        customer: { select: { name: true, phone: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;

    return {
      orders: page.map(toOrderDto),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Avanca o status validando a transicao pela maquina de estados de
   * @adventure/shared — a mesma que o painel usa para habilitar os botoes.
   */
  async updateStatus(
    orderId: string,
    nextStatus: OrderStatus,
    options: { adminId?: string | undefined; reason?: string | undefined } = {},
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, number: true, status: true, type: true, couponId: true },
    });

    if (!order) throw new NotFoundException('Pedido nao encontrado');

    /* Lanca InvalidStatusTransitionError quando a transicao nao existe. */
    try {
      assertTransition(order.status, nextStatus);
    } catch (error) {
      throw new ConflictException(
        error instanceof Error ? error.message : 'Transicao de status invalida',
      );
    }

    /**
     * Apos READY a tabela de transicoes permite os dois ramos, mas so um
     * faz sentido para cada tipo de pedido. Sem esta checagem, um pedido de
     * retirada poderia ser marcado como "saiu para entrega" e sumir do
     * balcao para o cliente que esta esperando ali.
     */
    if (nextStatus === OrderStatus.OUT_FOR_DELIVERY && order.type !== OrderType.DELIVERY) {
      throw new ConflictException('Este pedido e para retirada e nao sai para entrega.');
    }
    if (nextStatus === OrderStatus.AWAITING_PICKUP && order.type !== OrderType.PICKUP) {
      throw new ConflictException('Este pedido e para entrega e nao aguarda retirada no balcao.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: nextStatus,
          ...(nextStatus === OrderStatus.CONFIRMED ? { confirmedAt: new Date() } : {}),
          ...(nextStatus === OrderStatus.READY ? { readyAt: new Date() } : {}),
          ...(nextStatus === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
          ...(nextStatus === OrderStatus.CANCELED
            ? { canceledAt: new Date(), cancelReason: options.reason ?? null }
            : {}),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: nextStatus,
          changedByAdminId: options.adminId ?? null,
          reason: options.reason ?? null,
        },
      });

      /* Cancelamento devolve o uso do cupom, para o cliente poder usa-lo
         de novo em outro pedido. */
      if (nextStatus === OrderStatus.CANCELED && order.couponId) {
        await tx.coupon.update({
          where: { id: order.couponId },
          data: { usageCount: { decrement: 1 } },
        });
      }
    });

    this.logger.log(`Pedido ${order.number}: ${order.status} -> ${nextStatus}`);
    return this.findById(orderId);
  }

  /** Cancelamento pelo cliente, permitido apenas antes do preparo. */
  async cancelByCustomer(number: string, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: { number: number.toUpperCase() },
      select: { id: true, status: true },
    });

    if (!order) throw new NotFoundException('Pedido nao encontrado');

    if (isTerminalStatus(order.status)) {
      throw new ConflictException('Este pedido ja foi finalizado.');
    }

    if (!canCustomerCancel(order.status)) {
      throw new ConflictException(
        'Seu pedido ja esta em preparo. Fale com a loja pelo WhatsApp para cancelar.',
      );
    }

    return this.updateStatus(order.id, OrderStatus.CANCELED, { reason });
  }

  /**
   * Numero curto e sequencial por dia (ex.: A012), gritado na cozinha.
   * Vive dentro da transacao, e a unicidade e garantida pelo indice
   * [storeId, number] no banco.
   */
  private async nextOrderNumber(tx: Prisma.TransactionClient, storeId: string): Promise<string> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayCount = await tx.order.count({
      where: { storeId, createdAt: { gte: startOfDay } },
    });

    const letter = String.fromCharCode(65 + (Math.floor(todayCount / 999) % 26));
    return `${letter}${String((todayCount % 999) + 1).padStart(3, '0')}`;
  }
}

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    items: { include: { options: true } };
    customer: { select: { name: true; phone: true } };
    statusHistory: true;
  };
}>;

function toOrderDto(order: OrderWithRelations) {
  return {
    id: order.id,
    number: order.number,
    type: order.type,
    status: order.status,
    createdAt: order.createdAt,

    customer: {
      name: order.customer.name,
      /* Telefone parcialmente mascarado na resposta publica. */
      phone: order.customer.phone,
    },

    items: order.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      unitPriceFormatted: formatBRL(item.unitPriceCents),
      totalCents: item.totalCents,
      totalFormatted: formatBRL(item.totalCents),
      notes: item.notes,
      options: item.options.map((option) => ({
        name: option.optionName,
        priceCents: option.priceCents,
      })),
    })),

    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    totalFormatted: formatBRL(order.totalCents),

    paymentMethod: order.paymentMethod,
    changeForCents: order.changeForCents,

    address:
      order.type === OrderType.DELIVERY
        ? {
            zipCode: order.addressZipCode,
            street: order.addressStreet,
            number: order.addressNumber,
            complement: order.addressComplement,
            district: order.addressDistrict,
            city: order.addressCity,
            state: order.addressState,
            reference: order.addressReference,
          }
        : null,

    notes: order.notes,
    cancelReason: order.cancelReason,

    timeline: order.statusHistory.map((entry) => ({
      status: entry.toStatus,
      at: entry.createdAt,
      reason: entry.reason,
    })),
  };
}
