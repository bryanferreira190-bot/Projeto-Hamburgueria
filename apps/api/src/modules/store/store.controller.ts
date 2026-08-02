import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { StoreService, type StoreStatus } from './store.service';

/* Status de funcionamento e consumido pela landing, sem login. */
@Public()
@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  /** Status de funcionamento em tempo real, consumido pela landing e pelo storefront. */
  @Get('status')
  getStatus(): Promise<StoreStatus> {
    return this.storeService.getStatus();
  }
}
