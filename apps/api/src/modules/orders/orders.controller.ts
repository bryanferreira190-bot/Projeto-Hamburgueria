import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AdminRole,
  cancelOrderSchema,
  createManualOrderSchema,
  createOrderSchema,
  customerLookupQuerySchema,
  listOrdersFilterSchema,
  trackOrderQuerySchema,
  updateOrderStatusSchema,
  type CancelOrderInput,
  type CreateManualOrderInput,
  type CreateOrderInput,
  type CustomerLookupQuery,
  type ListOrdersFilter,
  type TrackOrderQuery,
  type UpdateOrderStatusInput,
} from '@adventure/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentAdmin, Public, RequireRole } from '../auth/decorators';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Criacao de pedido.
   *
   * Limite proprio: criar pedido escreve no banco e aciona a cozinha, entao
   * merece um teto mais baixo que o das rotas de leitura.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orders.create(body, idempotencyKey);
  }

  /**
   * Acompanhamento pelo numero curto do pedido.
   *
   * Exige o telefone usado no pedido como segundo fator (ver
   * trackOrderQuerySchema) — sem isso o numero curto e sequencial
   * ("A001", "A002"...) bastaria para ler dado de qualquer cliente.
   * Throttle porque a rota agora e, na pratica, uma tentativa de login.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('track/:number')
  track(
    @Param('number') number: string,
    @Query(new ZodValidationPipe(trackOrderQuerySchema)) query: TrackOrderQuery,
  ) {
    return this.orders.findByNumber(number, query.phone);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('track/:number/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('number') number: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: CancelOrderInput,
  ) {
    return this.orders.cancelByCustomer(number, body.phone, body.reason);
  }

  /* ---------------- Rotas administrativas ---------------- */

  /**
   * Pedido lancado no balcao pela cozinha.
   *
   * Rota separada da publica de proposito: aqui quem esta pedindo esta na
   * frente do atendente, entao horario de funcionamento, pedido minimo e
   * cobranca online nao se aplicam — ver createManual().
   */
  @RequireRole(AdminRole.KITCHEN)
  @Post('manual')
  @HttpCode(HttpStatus.CREATED)
  createManual(
    @Body(new ZodValidationPipe(createManualOrderSchema)) body: CreateManualOrderInput,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.orders.createManual(body, adminId);
  }

  /**
   * Nome ja associado a este telefone, se houver.
   *
   * O balcao consulta isto ANTES de lancar o pedido — cadastro e por
   * telefone, e digitar um numero que ja pertence a outra pessoa
   * renomeia o cliente errado sem avisar ninguem. Ver createManual.
   */
  @RequireRole(AdminRole.KITCHEN)
  @Get('customer-lookup')
  customerLookup(
    @Query(new ZodValidationPipe(customerLookupQuerySchema)) query: CustomerLookupQuery,
  ) {
    return this.orders.buscarClientePorTelefone(query.phone);
  }

  @RequireRole(AdminRole.KITCHEN)
  @Get()
  list(@Query(new ZodValidationPipe(listOrdersFilterSchema)) filter: ListOrdersFilter) {
    return this.orders.list(filter);
  }

  @RequireRole(AdminRole.KITCHEN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findById(id);
  }

  @RequireRole(AdminRole.KITCHEN)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOrderStatusSchema)) body: UpdateOrderStatusInput,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.orders.updateStatus(id, body.status, { adminId, reason: body.reason });
  }
}
