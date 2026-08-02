import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { StoreModule } from '../store/store.module';
import { OrderPricingService } from './order-pricing.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StoreModule, DeliveryModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderPricingService],
  exports: [OrdersService],
})
export class OrdersModule {}
