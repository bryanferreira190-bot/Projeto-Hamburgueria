import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ImageStorageService } from './image-storage.service';
import { ProductsAdminController } from './products-admin.controller';
import { ProductsAdminService } from './products-admin.service';

@Module({
  controllers: [CatalogController, ProductsAdminController],
  providers: [CatalogService, ImageStorageService, ProductsAdminService],
  exports: [CatalogService],
})
export class CatalogModule {}
