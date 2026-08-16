import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { CatalogService, type CategoryDto, type ProductDto } from './catalog.service';
import { ImageStorageService } from './image-storage.service';

/* O cardapio e vitrine: aberto, sem autenticacao. */
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly images: ImageStorageService,
  ) {}

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

  /**
   * Serve a foto guardada no banco.
   *
   * O cache e agressivo (1 ano, immutable) porque a URL carrega a versao
   * da foto: trocar a imagem gera uma URL nova, entao nenhum navegador
   * fica preso na versao antiga.
   */
  @Get('products/:id/image')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getProductImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.images.load(id);

    if (!image) throw new NotFoundException('Este produto ainda nao tem foto.');

    response.setHeader('Content-Type', image.mimeType);
    response.setHeader('Content-Length', image.data.length);
    response.end(image.data);
  }
}
