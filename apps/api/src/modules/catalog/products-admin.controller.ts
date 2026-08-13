import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AdminRole,
  PRODUCT_IMAGE,
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '@adventure/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentAdmin, RequireRole } from '../auth/decorators';
import { CatalogService } from './catalog.service';
import { ProductsAdminService } from './products-admin.service';
import type { ArquivoEnviado } from './uploaded-file';

/**
 * Gestao do cardapio.
 *
 * Exige MANAGER: mexer em preco e o que decide quanto a loja fatura, e nao
 * e tarefa de cozinha nem de entrega.
 */
@RequireRole(AdminRole.MANAGER)
@Controller('admin/products')
export class ProductsAdminController {
  constructor(
    private readonly products: ProductsAdminService,
    private readonly catalog: CatalogService,
  ) {}

  /** Cardapio completo para a tela de edicao, incluindo itens indisponiveis. */
  @Get()
  list() {
    return this.catalog.getMenu();
  }

  /** Limites da foto, para o formulario montar a dica sem repetir numeros. */
  @Get('image-rules')
  imageRules() {
    return this.products.getImageRules();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
    @CurrentAdmin('storeId') storeId: string,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.products.create(storeId, body, adminId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentAdmin('sub') adminId: string,
  ) {
    return this.products.update(id, body, adminId);
  }

  @Post(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      /* Guardado em memoria porque segue direto para o banco — em disco
         seria um arquivo temporario sem dono numa hospedagem efemera. */
      limits: { fileSize: PRODUCT_IMAGE.maxBytes },
    }),
  )
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: ArquivoEnviado | undefined,
    @CurrentAdmin('sub') adminId: string,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    return this.products.replaceImage(id, file, adminId);
  }

  @Delete(':id/image')
  removeImage(@Param('id') id: string, @CurrentAdmin('sub') adminId: string) {
    return this.products.removeImage(id, adminId);
  }
}
