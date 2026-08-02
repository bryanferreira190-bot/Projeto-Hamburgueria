import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { CatalogService, type CategoryDto, type ProductDto } from './catalog.service';

/* O cardapio e vitrine: aberto, sem autenticacao. */
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  /** Cardapio completo, agrupado por categoria. */
  @Get('menu')
  getMenu(): Promise<CategoryDto[]> {
    return this.catalogService.getMenu();
  }

  @Get('featured')
  getFeatured(): Promise<ProductDto[]> {
    return this.catalogService.getFeatured();
  }

  @Get('products/:slug')
  getProduct(@Param('slug') slug: string): Promise<ProductDto> {
    return this.catalogService.getProductBySlug(slug);
  }
}
