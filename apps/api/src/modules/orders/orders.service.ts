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
  PaymentMethod,
  TERMINAL_STATUSES,
  assertTransition,
  canCustomerCancel,
  formatBRL,
  isCardPayment,
  isOnlinePayment,
  isTerminalStatus,
  type CreateManualOrderInput,
  type CreateOrderInput,
  type CustomerLookup,
  type ListOrdersFilter,
} from '@adventure/shared';
import { Prisma, type Order } from '@prisma/client';
import { hojeNoFusoDaLoja } from '../../common/timezone';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CashbackService } from '../cashback/cashback.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PaymentsService } from '../payments/payments.service';
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
    private readonly payments: PaymentsService,
    private readonly cashback: CashbackService,
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

    const order = await this.criarPedidoComRetentativa(store, idempotencyKey, async (tx) => {
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

      /* A checagem do troco fica mais abaixo, DEPOIS de calcular o
         cashback: o valor que o cliente vai pagar de fato e o total
         menos o saldo abatido. */

      const customer = await tx.customer.upsert({
        where: { storeId_phone: { storeId: store.id, phone: input.customer.phone } },
        update: {
          name: input.customer.name,
          lastOrderAt: new Date(),
          ...(input.customer.email ? { email: input.customer.email } : {}),
        },
        create: {
          storeId: store.id,
          phone: input.customer.phone,
          name: input.customer.name,
          email: input.customer.email ?? null,
          lastOrderAt: new Date(),
        },
      });

      /**
       * CASHBACK: o valor pedido pelo cliente e so um pedido.
       *
       * O saldo real e o teto da loja sao recalculados aqui, DENTRO da
       * transacao — confiar no numero que veio do navegador deixaria
       * qualquer um zerar o proprio pedido mandando um valor alto pelo
       * DevTools, exatamente como acontece com preco (ver o comentario
       * no topo de createOrderSchema).
       *
       * `consumir` roda na mesma transacao: se a criacao do pedido
       * falhar adiante, o saldo debitado volta junto no rollback, em vez
       * de sumir sem pedido nenhum para mostrar.
       */
      let cashbackUsedCents = 0;
      if (input.cashbackToUseCents && input.cashbackToUseCents > 0) {
        const saldo = await this.cashback.saldoDoCliente(customer.id);
        const permitido = this.cashback.calcularResgateMaximo(
          priced.subtotalCents - priced.discountCents,
          saldo.totalCents,
          store.cashbackMaxRedeemPercent,
        );

        cashbackUsedCents = await this.cashback.consumir(
          tx,
          customer.id,
          Math.min(input.cashbackToUseCents, permitido),
        );
      }

      const totalCents = priced.totalCents - cashbackUsedCents;

      /* Troco precisa cobrir o total DEPOIS do cashback — senao o
         entregador levaria troco para um valor que o cliente nem vai
         pagar. */
      if (input.changeForCents !== undefined && input.changeForCents < totalCents) {
        throw new BadRequestException(
          `O valor para troco (${formatBRL(input.changeForCents)}) e menor que o total (${formatBRL(totalCents)}).`,
        );
      }

      /* Pagamento online nasce aguardando confirmacao do provedor; na
         entrega, o pedido ja entra confirmado para a cozinha. */
      const initialStatus = isOnlinePayment(input.paymentMethod)
        ? OrderStatus.PENDING_PAYMENT
        : OrderStatus.CONFIRMED;

      /* Calculado uma unica vez e reaproveitado abaixo: garante que o
         numero gerado e o orderDate gravado sejam sempre do mesmo dia,
         mesmo no instante raro em que a meia-noite cai no meio da
         transacao. */
      const hoje = hojeNoFusoDaLoja();

      const created = await tx.order.create({
        data: {
          storeId: store.id,
          number: await this.nextOrderNumber(tx, store.id, hoje),
          orderDate: hoje,
          customerId: customer.id,
          couponId: priced.couponId,
          type: input.type,
          status: initialStatus,
          subtotalCents: priced.subtotalCents,
          deliveryFeeCents: priced.deliveryFeeCents,
          discountCents: priced.discountCents,
          cashbackUsedCents,
          totalCents,
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

    /**
     * A cobranca PIX e criada FORA da transacao acima de proposito: e uma
     * chamada de rede para o Mercado Pago, e segurar uma transacao de
     * banco aberta enquanto se espera uma resposta externa arrisca
     * travar linhas por mais tempo que o necessario.
     *
     * Se o Mercado Pago falhar aqui, o pedido ja existe mas ninguem
     * consegue pagar — pior do que nao ter pedido nenhum. Por isso ele e
     * cancelado explicitamente e o cliente recebe um erro claro, em vez
     * de ficar parado para sempre em "aguardando pagamento".
     */
    if (input.paymentMethod === PaymentMethod.PIX) {
      try {
        await this.payments.createPixForOrder({
          id: order.id,
          number: order.number,
          totalCents: order.totalCents,
          /* O "!" e seguro: createOrderSchema exige email quando o
             pagamento e online, e essa validacao ja rodou no controller. */
          payerEmail: input.customer.email!,
          payerFirstName: input.customer.name.split(' ')[0],
        });
      } catch (error) {
        await this.updateStatus(order.id, OrderStatus.CANCELED, {
          reason: 'Falha ao gerar cobranca PIX',
        });
        throw error;
      }
    }

    /**
     * Cartao resolve na hora: o Mercado Pago aprova ou recusa na propria
     * chamada. Aprovado, o pedido ja vai confirmado para a cozinha, sem
     * passar por "aguardando pagamento" — nao ha o que esperar.
     */
    if (isCardPayment(input.paymentMethod)) {
      try {
        const { aprovado } = await this.payments.createCardForOrder({
          id: order.id,
          number: order.number,
          totalCents: order.totalCents,
          payerEmail: input.customer.email!,
          payerFirstName: input.customer.name.split(' ')[0],
          card: input.card!,
        });

        if (aprovado) {
          await this.updateStatus(order.id, OrderStatus.CONFIRMED, {
            reason: 'Pagamento aprovado no cartao',
          });
        }
      } catch (error) {
        /* Recusa do cartao tambem cai aqui: o pedido nao pode ficar de pe
           sem pagamento, e a mensagem que sobe ja explica o motivo. */
        await this.updateStatus(order.id, OrderStatus.CANCELED, {
          reason: 'Pagamento no cartao nao aprovado',
        });
        throw error;
      }
    }

    return this.findById(order.id);
  }

  /**
   * Cliente ja cadastrado com este telefone, se houver.
   *
   * Usado pelo balcao ANTES de lancar o pedido: cadastro e por telefone
   * (ver customer.upsert em createManual, logo abaixo), entao digitar um
   * numero que ja pertence a outra pessoa renomeia o cliente errado sem
   * avisar ninguem — foi exatamente o que aconteceu na pratica. Mostrar
   * o nome já associado a este telefone deixa quem esta atendendo
   * perceber a tempo, antes de confirmar.
   */
  async buscarClientePorTelefone(phone: string): Promise<CustomerLookup | null> {
    const store = await this.prisma.store.findFirst({ select: { id: true } });
    if (!store) return null;

    const customer = await this.prisma.customer.findUnique({
      where: { storeId_phone: { storeId: store.id, phone } },
      select: { name: true },
    });

    return customer ? { name: customer.name } : null;
  }

  /**
   * Cancela TODOS os pedidos em aberto de uma vez — botao do painel para
   * limpar o Kanban sem cancelar pedido de teste um por um.
   *
   * Reaproveita updateStatus() para cada pedido, e nao um updateMany
   * direto no banco: precisa do mesmo tratamento de sempre por pedido —
   * estorno se ja tiver sido pago, devolucao de cupom, anulacao de
   * cashback ja creditado (ver anularCreditoDoPedido). Um updateMany em
   * massa puraria por cima de tudo isso. Um pedido que falhar (corrida
   * com o cliente pagando ou com outro admin mexendo nele ao mesmo tempo)
   * nao impede os demais.
   */
  async cancelarTodosAbertos(reason: string): Promise<{ cancelados: number; falharam: number }> {
    const abertos = await this.prisma.order.findMany({
      where: { status: { notIn: [...TERMINAL_STATUSES] } },
      select: { id: true, number: true },
    });

    let cancelados = 0;
    let falharam = 0;

    for (const pedido of abertos) {
      try {
        await this.updateStatus(pedido.id, OrderStatus.CANCELED, { reason });
        cancelados += 1;
      } catch (error) {
        falharam += 1;
        this.logger.error(
          `Falha ao cancelar o pedido ${pedido.number} na limpeza em massa`,
          error as Error,
        );
      }
    }

    this.logger.log(
      `Limpeza de pedidos em aberto: ${cancelados} cancelado(s), ${falharam} falha(s)`,
    );
    return { cancelados, falharam };
  }

  /**
   * PEDIDO LANCADO NO BALCAO PELA COZINHA
   *
   * Caminho proprio, e nao um `create()` com campos opcionais, porque as
   * regras sao praticamente opostas — e cada uma das diferencas abaixo
   * seria um bug se o fluxo fosse compartilhado:
   *
   * - NAO checa horario de funcionamento. Se ha alguem no balcao pedindo,
   *   a loja esta aberta de fato; recusar a venda porque a agenda diz que
   *   fechou seria o sistema discutindo com a realidade e perdendo
   *   dinheiro.
   * - NAO aplica pedido minimo: minimo existe para nao valer a pena
   *   mandar entregador, e aqui nao sai entregador nenhum.
   * - NAO cria cobranca no Mercado Pago. O dinheiro entra na mao ali; o
   *   metodo de pagamento e so registro para o fechamento do caixa.
   * - Ja nasce CONFIRMED: nao ha pagamento online a esperar.
   * - Cliente e opcional (ver customerId no schema).
   */
  async createManual(input: CreateManualOrderInput, adminId: string) {
    const store = await this.prisma.store.findFirst();
    if (!store) throw new NotFoundException('Loja nao configurada');

    const order = await this.criarPedidoComRetentativa(store, undefined, async (tx) => {
      /* Mesmo servico de preco do site: o balcao manda o QUE foi pedido,
         nunca quanto custa. Preco vem sempre do banco. */
      const priced = await this.pricing.price(tx, {
        storeId: store.id,
        items: input.items,
        deliveryFeeCents: 0,
      });

      if (input.changeForCents !== undefined && input.changeForCents < priced.totalCents) {
        throw new BadRequestException(
          `O valor recebido (${formatBRL(input.changeForCents)}) e menor que o total (${formatBRL(priced.totalCents)}).`,
        );
      }

      /* So vira Customer quem deixou telefone — e o telefone que
         identifica o cliente. Com nome apenas, o nome fica no proprio
         pedido (manualCustomerName) e nenhum cadastro e criado. */
      const customerId = input.customerPhone
        ? (
            await tx.customer.upsert({
              where: { storeId_phone: { storeId: store.id, phone: input.customerPhone } },
              update: {
                lastOrderAt: new Date(),
                ...(input.customerName ? { name: input.customerName } : {}),
              },
              create: {
                storeId: store.id,
                phone: input.customerPhone,
                name: input.customerName ?? null,
                lastOrderAt: new Date(),
              },
            })
          ).id
        : null;

      const hoje = hojeNoFusoDaLoja();

      return tx.order.create({
        data: {
          storeId: store.id,
          number: await this.nextOrderNumber(tx, store.id, hoje),
          orderDate: hoje,
          customerId,
          isManual: true,
          type: OrderType.PICKUP,
          status: OrderStatus.CONFIRMED,
          confirmedAt: new Date(),
          subtotalCents: priced.subtotalCents,
          deliveryFeeCents: 0,
          discountCents: priced.discountCents,
          totalCents: priced.totalCents,
          paymentMethod: input.paymentMethod,
          changeForCents: input.changeForCents ?? null,
          notes: input.notes ?? null,
          /* Com telefone o nome foi para o Customer no upsert acima; sem
             telefone ele so tem este lugar para existir. */
          manualCustomerName: input.customerPhone ? null : (input.customerName ?? null),

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
            create: {
              toStatus: OrderStatus.CONFIRMED,
              reason: 'Pedido lancado no balcao',
              /* Quem bateu a venda: e dinheiro entrando na mao, entao
                 precisa ficar registrado quem registrou. */
              changedByAdminId: adminId,
            },
          },
        },
      });
    });

    this.logger.log(`Pedido ${order.number} lancado no balcao — ${formatBRL(order.totalCents)}`);
    return this.findById(order.id);
  }

  async findById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { options: true } },
        customer: { select: { name: true, phone: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        /* So o pagamento mais recente interessa aqui — nao ha reemissao
           de PIX hoje, entao um pedido tem no maximo um Payment. */
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!order) throw new NotFoundException('Pedido nao encontrado');
    return toOrderDto(order);
  }

  /**
   * Consulta publica pelo numero curto, para o cliente acompanhar.
   *
   * O numero SO e unico dentro do mesmo dia (ver nextOrderNumber) — "A001"
   * de hoje e "A001" de semana passada sao pedidos diferentes. Por isso
   * pega sempre o mais recente: e o que a pessoa quase certamente quer
   * dizer ao digitar o numero que acabou de receber.
   *
   * EXIGE o telefone do pedido (ver trackOrderQuerySchema). Sem isso,
   * numero + enumeracao ("A001", "A002"...) bastariam para ler nome,
   * telefone e endereco de qualquer cliente. Numero errado e telefone
   * errado devolvem exatamente o mesmo erro — nao da pra usar a resposta
   * para descobrir se um numero de pedido existe.
   */
  async findByNumber(number: string, phone: string) {
    const store = await this.prisma.store.findFirst({ select: { id: true } });
    if (!store) throw new NotFoundException('Loja nao configurada');

    const order = await this.prisma.order.findFirst({
      where: { storeId: store.id, number: number.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      include: {
        items: { include: { options: true } },
        customer: { select: { name: true, phone: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        /* So o pagamento mais recente interessa aqui — nao ha reemissao
           de PIX hoje, entao um pedido tem no maximo um Payment. */
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    /* Pedido de balcao sem telefone nao tem cliente e, portanto, nao tem
       como ser acompanhado publicamente — nao ha o que conferir contra. */
    if (!order || order.customer?.phone !== phone) {
      throw new NotFoundException('Pedido nao encontrado');
    }
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

    /**
     * SEM statusHistory nem payments aqui, de proposito: nenhum dos dois
     * e usado pelo painel (ver OrderRow em apps/admin/src/lib/api.ts —
     * nao declara `timeline` nem `payment`). So a tela de acompanhamento
     * do cliente (findByNumber/findById, mais abaixo) usa esses campos.
     *
     * Essa diferenca importa MUITO aqui: esta e a consulta mais pesada
     * do sistema (ate 100 pedidos, com itens e adicionais) e a mais
     * chamada (o painel repete a cada 15s, o dia inteiro). Buscar e
     * serializar o historico completo de status de cada pedido, sem
     * ninguem ler o resultado do outro lado, era trabalho puro jogado
     * fora — tanto no banco quanto nos bytes que voltam pela rede.
     */
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: {
        items: { include: { options: true } },
        customer: { select: { name: true, phone: true } },
      },
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;

    return {
      orders: page.map((row) => toOrderDto({ ...row, statusHistory: [], payments: [] })),
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
      /**
       * COMPARE-AND-SWAP: so escreve se o status ainda for o mesmo que foi
       * lido no findUnique acima. Sem isso, duas requisicoes concorrentes
       * (duplo clique em "cancelar", ou o webhook do Mercado Pago e um
       * admin agindo ao mesmo tempo no mesmo pedido) passariam as duas pela
       * validacao de transicao antes de qualquer uma escrever — e as duas
       * aplicariam a mudanca: duas linhas em OrderStatusHistory, cupom
       * decrementado duas vezes, e ate estorno duplicado na Mercado Pago
       * (refundIfPaid, logo abaixo, olha o Payment ainda como PAID nos dois
       * casos). updateMany com o status antigo no WHERE faz a segunda
       * tentativa encontrar zero linhas — momento em que ela descobre que
       * perdeu a corrida, em vez de aplicar a mudanca por cima.
       */
      const alterado = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
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

      if (alterado.count === 0) {
        throw new ConflictException(
          'Este pedido acabou de ser atualizado por outra acao. Recarregue e tente de novo.',
        );
      }

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

      /* Cancelamento tambem anula o que sobrou de cashback deste pedido
         — ele pode ja ter sido creditado, se o pedido tinha chegado a
         PREPARING antes de ser cancelado. Ver creditarPorPedido abaixo
         e o comentario em anularCreditoDoPedido. */
      if (nextStatus === OrderStatus.CANCELED) {
        await this.cashback.anularCreditoDoPedido(tx, orderId);
      }
    });

    /* Fora da transacao de proposito: chamada de rede nao deveria acontecer
       com uma transacao de banco aberta (mesmo motivo do PIX em
       PaymentsService). O pedido ja esta CANCELED nesse ponto -- a cozinha
       para na hora mesmo que o estorno em si demore ou falhe. */
    if (nextStatus === OrderStatus.CANCELED) {
      await this.payments.refundIfPaid(orderId, order.number);
    }

    /**
     * Cashback credita quando o pedido entra em PREPARO — antes da
     * entrega, de proposito, para o cliente ver o saldo crescer mais
     * cedo. Contrapartida aceita: se o pedido for cancelado depois disso,
     * o credito ja pode ter sido criado (e ate gasto em outro pedido).
     * `anularCreditoDoPedido`, chamado no bloco de cancelamento acima,
     * desfaz o que ainda nao foi gasto; o que ja foi gasto fica como
     * perda aceita. Ver DECISOES.md.
     *
     * Falha aqui NAO derruba a mudanca de status: o pedido ja esta em
     * preparo de fato, e travar isso por causa do cashback seria pior do
     * que o credito atrasar. Fica registrado para conciliar.
     */
    if (nextStatus === OrderStatus.PREPARING) {
      try {
        await this.cashback.creditarPorPedido(orderId);
      } catch (error) {
        this.logger.error(
          `Pedido ${order.number} em preparo, mas o cashback nao foi creditado. ` +
            `Credite manualmente se o cliente cobrar.`,
          error as Error,
        );
      }
    }

    this.logger.log(`Pedido ${order.number}: ${order.status} -> ${nextStatus}`);
    return this.findById(orderId);
  }

  /**
   * Cancelamento pelo cliente, permitido apenas antes do preparo.
   *
   * Mesmo cuidado de findByNumber: o numero repete a cada dia, entao pega
   * sempre o pedido mais recente com esse numero. E MESMA EXIGENCIA de
   * telefone — sem ela, bastaria adivinhar/enumerar o numero do dia para
   * cancelar o pedido de outra pessoa.
   */
  async cancelByCustomer(number: string, phone: string, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: { number: number.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, customer: { select: { phone: true } } },
    });

    if (!order || order.customer?.phone !== phone) {
      throw new NotFoundException('Pedido nao encontrado');
    }

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
  /**
   * "A001", "A002"... reiniciando a cada dia NO FUSO DA LOJA.
   *
   * Contar por `orderDate` (coluna so-de-data, no fuso certo) em vez de
   * `createdAt >= inicio do dia em UTC` e o que faz o numero realmente
   * reiniciar no horario que faz sentido para o negocio — a loja abre a
   * noite (18h-22h30 em Brasilia = 21h-01h30 UTC), entao um limite em
   * UTC cairia no meio do proprio expediente. Ver DECISOES.md.
   */
  private async nextOrderNumber(
    tx: Prisma.TransactionClient,
    storeId: string,
    hoje: Date,
  ): Promise<string> {
    const contagemDeHoje = await tx.order.count({
      where: { storeId, orderDate: hoje },
    });

    const letter = String.fromCharCode(65 + (Math.floor(contagemDeHoje / 999) % 26));
    return `${letter}${String((contagemDeHoje % 999) + 1).padStart(3, '0')}`;
  }

  /**
   * Roda a transacao de criacao do pedido, tentando de novo em caso de
   * colisao de unicidade (P2002) -- pode acontecer em dois cenarios raros
   * mas reais, que so aparecem quando ja existe mais de uma requisicao
   * disputando a mesma chave ao mesmo tempo:
   *
   *  - duas requisicoes com a MESMA idempotencyKey quase juntas (duplo
   *    clique, retry de rede do proprio navegador) — a segunda encontra a
   *    constraint (storeId, idempotencyKey) ja ocupada pela primeira, que
   *    commitou um instante antes;
   *  - dois pedidos DIFERENTES calculando o mesmo numero do dia ao mesmo
   *    tempo — nextOrderNumber() conta e monta sem lock (ver comentario
   *    la), entao duas transacoes concorrentes podem calcular "A012" cada
   *    uma, e so uma consegue gravar.
   *
   * Sem isto, a segunda tentativa simplesmente falhava com "erro
   * inesperado" (500) para quem estava pedindo, mesmo com dados
   * perfeitamente validos — em horario de pico, isso pode acontecer de
   * verdade entre dois clientes diferentes, nao so em duplo clique do
   * mesmo cliente.
   */
  private async criarPedidoComRetentativa(
    store: { id: string },
    idempotencyKey: string | undefined,
    transacao: (tx: Prisma.TransactionClient) => Promise<Order>,
  ): Promise<Order> {
    const TENTATIVAS = 3;

    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
      try {
        return await this.prisma.$transaction(transacao);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }

        /* Colisao na propria idempotencyKey: a OUTRA requisicao concorrente
           ja criou o pedido — devolve ele, em vez de tentar de novo (tentar
           de novo so geraria a mesma colisao para sempre). */
        const alvo = error.meta?.target;
        const colidiuNaIdempotencia =
          idempotencyKey &&
          Array.isArray(alvo) &&
          alvo.some((coluna) => String(coluna).includes('idempotencyKey'));

        if (colidiuNaIdempotencia) {
          const existente = await this.prisma.order.findFirst({
            where: { storeId: store.id, idempotencyKey },
          });
          if (existente) {
            this.logger.log(
              `Pedido ${existente.number} devolvido por idempotencia (colisao concorrente)`,
            );
            return existente;
          }
        }

        /* Colisao no numero do dia: outra transacao pegou o mesmo numero
           entre o count() e o create(). Tenta de novo do zero — na proxima
           volta o count() ja ve o pedido que acabou de ser gravado. */
        if (tentativa === TENTATIVAS) throw error;
        this.logger.warn(
          `Colisao ao criar pedido (tentativa ${tentativa}/${TENTATIVAS}), tentando de novo`,
        );
      }
    }

    /* Inalcancavel (o loop sempre retorna ou lanca), mas o TypeScript
       exige um caminho de retorno explicito. */
    throw new Error('Falha ao criar pedido apos varias tentativas');
  }
}

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    items: { include: { options: true } };
    customer: { select: { name: true; phone: true } };
    statusHistory: true;
    payments: true;
  };
}>;

/**
 * Junta adicionais repetidos numa linha so, com a quantidade.
 *
 * No banco cada unidade e uma linha propria — pedir dois bacons grava
 * duas linhas, e e assim que o preco de cada uma entra na conta. Para
 * quem le (cozinha e cliente), porem, "2x Bacon" e mais claro do que
 * "Bacon" duas vezes seguidas; agrupar aqui evita repetir essa mesma
 * logica no painel e na tela de acompanhamento.
 */
function agruparAdicionais(
  options: { optionId: string; optionName: string; priceCents: number }[],
) {
  const porOpcao = new Map<string, { name: string; priceCents: number; quantity: number }>();

  for (const option of options) {
    const atual = porOpcao.get(option.optionId);
    if (atual) atual.quantity += 1;
    else
      porOpcao.set(option.optionId, {
        name: option.optionName,
        /* Preco de UMA unidade; a quantidade fica no campo ao lado. */
        priceCents: option.priceCents,
        quantity: 1,
      });
  }

  return [...porOpcao.values()];
}

function toOrderDto(order: OrderWithRelations) {
  return {
    id: order.id,
    number: order.number,
    type: order.type,
    status: order.status,
    createdAt: order.createdAt,

    isManual: order.isManual,

    /**
     * NULO em pedido de balcao sem telefone — nao ha cadastro de cliente
     * nenhum por tras dele (ver customerId no schema). Quem consome isto
     * precisa tratar a ausencia; e por isso que e `null` inteiro, e nao
     * um objeto com campos vazios que passaria despercebido.
     *
     * Quando existe, so chega aqui quem ja provou saber o telefone do
     * pedido — ver findByNumber/cancelByCustomer.
     */
    customer: order.customer ? { name: order.customer.name, phone: order.customer.phone } : null,

    /* Nome dito no balcao por quem nao deixou telefone. Fica fora de
       `customer` de proposito: nao ha cliente cadastrado, e fingir que ha
       levaria alguem a tentar mandar WhatsApp para um telefone que nao
       existe. */
    manualCustomerName: order.manualCustomerName,

    items: order.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      unitPriceFormatted: formatBRL(item.unitPriceCents),
      totalCents: item.totalCents,
      totalFormatted: formatBRL(item.totalCents),
      notes: item.notes,
      options: agruparAdicionais(item.options),
    })),

    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    discountCents: order.discountCents,
    cashbackUsedCents: order.cashbackUsedCents,
    totalCents: order.totalCents,
    totalFormatted: formatBRL(order.totalCents),

    paymentMethod: order.paymentMethod,
    changeForCents: order.changeForCents,
    payment: order.payments[0]
      ? {
          status: order.payments[0].status,
          /* So faz sentido mostrar o QR de um PIX ainda pendente — depois
             de pago ou cancelado ele nao serve mais para nada. */
          pixQrCode: order.payments[0].status === 'PENDING' ? order.payments[0].pixQrCode : null,
          pixCopyPaste:
            order.payments[0].status === 'PENDING' ? order.payments[0].pixCopyPaste : null,
          pixExpiresAt: order.payments[0].pixExpiresAt,
        }
      : null,

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
