import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PRODUCT_IMAGE,
  formatBRL,
  validateProductImage,
  type CreateProductInput,
  type UpdateProductInput,
} from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ImageStorageService } from './image-storage.service';
import type { ArquivoEnviado } from './uploaded-file';

@Injectable()
export class ProductsAdminService {
  private readonly logger = new Logger(ProductsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageStorageService,
  ) {}

  /**
   * Atualiza nome, descricao, preco e disponibilidade.
   *
   * O slug NAO muda junto com o nome de proposito: ele e a chave usada
   * nos links e no seed que le o cardapio da landing. Renomear o produto
   * nao pode quebrar um link que ja foi compartilhado.
   */
  async update(productId: string, input: UpdateProductInput, adminId: string) {
    const atual = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, name: true, priceCents: true },
    });

    if (!atual) throw new NotFoundException('Produto nao encontrado');

    const produto = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description === '' ? null : input.description }
          : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
      },
      /* Sem esta lista o Prisma devolveria tambem o imageData — os bytes
         da foto — so para responder a edicao de um preco. */
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        imageMimeType: true,
        imageVersion: true,
        priceCents: true,
        isAvailable: true,
        isFeatured: true,
      },
    });

    /* Mudanca de preco fica registrada: e o campo que mais gera duvida
       depois ("por que esse pedido saiu por outro valor?"). */
    if (input.priceCents !== undefined && input.priceCents !== atual.priceCents) {
      this.logger.log(
        `Preco de "${atual.name}" alterado de ${formatBRL(atual.priceCents)} para ${formatBRL(input.priceCents)} pelo admin ${adminId}`,
      );
    }

    await this.registrarAuditoria(adminId, productId, atual, input);

    return this.toDto(produto);
  }

  /**
   * Cadastra um produto novo.
   *
   * Entra sem foto e disponivel por padrao: a foto se envia depois, pelo
   * mesmo botao "Editar" que ja existe, e destravar o pedido na hora
   * evita a pessoa cadastrar e esquecer de marcar como disponivel.
   */
  async create(storeId: string, input: CreateProductInput, adminId: string) {
    const categoria = await this.prisma.category.findFirst({
      where: { id: input.categoryId, storeId },
      select: { id: true },
    });
    if (!categoria) throw new BadRequestException('Categoria nao encontrada');

    const slug = await this.gerarSlugUnico(storeId, input.name);

    /* Novo produto entra no fim da propria categoria, nao da lista toda —
       e a posicao que a pessoa que esta cadastrando espera ver. */
    const ultimo = await this.prisma.product.findFirst({
      where: { storeId, categoryId: input.categoryId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const produto = await this.prisma.product.create({
      data: {
        storeId,
        categoryId: input.categoryId,
        slug,
        name: input.name,
        description: input.description || null,
        priceCents: input.priceCents,
        isAvailable: input.isAvailable ?? true,
        position: (ultimo?.position ?? -1) + 1,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        imageMimeType: true,
        imageVersion: true,
        priceCents: true,
        isAvailable: true,
        isFeatured: true,
      },
    });

    this.logger.log(`Produto "${produto.name}" cadastrado pelo admin ${adminId}`);

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'product.create',
        entityType: 'product',
        entityId: produto.id,
        after: { name: input.name, priceCents: input.priceCents, categoryId: input.categoryId },
      },
    });

    return this.toDto(produto);
  }

  /**
   * Transforma o nome num slug e garante que ele e unico na loja,
   * acrescentando "-2", "-3" etc. quando ja existir (dois produtos
   * chamados "Combo Especial" nao podem colidir na mesma URL).
   */
  private async gerarSlugUnico(storeId: string, name: string): Promise<string> {
    const base = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove os acentos separados pelo NFD (marcas combinantes)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 140);

    let slug = base || 'produto';
    let sufixo = 2;

    while (await this.prisma.product.findFirst({ where: { storeId, slug }, select: { id: true } })) {
      slug = `${base || 'produto'}-${sufixo}`;
      sufixo += 1;
    }

    return slug;
  }

  async replaceImage(productId: string, file: ArquivoEnviado, adminId: string) {
    const produto = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, name: true },
    });

    if (!produto) throw new NotFoundException('Produto nao encontrado');

    /* Mesma validacao que o navegador ja fez — quem envia direto na API
       nao passa pelo formulario. */
    const erro = validateProductImage({ size: file.size, type: file.mimetype });
    if (erro) throw new BadRequestException(erro);

    const imageUrl = await this.images.save(productId, file.buffer, file.mimetype);

    this.logger.log(
      `Foto de "${produto.name}" trocada pelo admin ${adminId} (${Math.round(file.size / 1024)} KB)`,
    );

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'product.image.replace',
        entityType: 'product',
        entityId: productId,
        after: { imageUrl, sizeBytes: file.size, mimeType: file.mimetype },
      },
    });

    return { imageUrl };
  }

  /**
   * Tira a foto do produto.
   *
   * O cardapio nao quebra sem foto — o cartao cai no icone padrao —, entao
   * apagar e uma saida legitima para uma foto ruim, sem obrigar a pessoa a
   * arrumar outra na hora.
   */
  async removeImage(productId: string, adminId: string) {
    const produto = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, name: true, imageUrl: true, imageMimeType: true },
    });

    if (!produto) throw new NotFoundException('Produto nao encontrado');

    await this.images.remove(productId);

    this.logger.log(`Foto de "${produto.name}" removida pelo admin ${adminId}`);

    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'product.image.remove',
        entityType: 'product',
        entityId: productId,
        before: { imageUrl: produto.imageUrl, mimeType: produto.imageMimeType },
      },
    });

    return { imageUrl: null };
  }

  /** Limites do upload, para o formulario montar a dica sem duplicar numero. */
  getImageRules() {
    return {
      recommendedWidth: PRODUCT_IMAGE.recommendedWidth,
      recommendedHeight: PRODUCT_IMAGE.recommendedHeight,
      maxBytes: PRODUCT_IMAGE.maxBytes,
      acceptedMimeTypes: PRODUCT_IMAGE.acceptedMimeTypes,
    };
  }

  private async registrarAuditoria(
    adminId: string,
    productId: string,
    antes: { name: string; priceCents: number },
    depois: UpdateProductInput,
  ) {
    await this.prisma.auditLog.create({
      data: {
        adminUserId: adminId,
        action: 'product.update',
        entityType: 'product',
        entityId: productId,
        before: { name: antes.name, priceCents: antes.priceCents },
        after: { ...depois },
      },
    });
  }

  private toDto(produto: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    imageMimeType: string | null;
    imageVersion: number;
    priceCents: number;
    isAvailable: boolean;
    isFeatured: boolean;
  }) {
    return {
      id: produto.id,
      slug: produto.slug,
      name: produto.name,
      description: produto.description,
      imageUrl: this.images.resolveUrl(produto),
      priceCents: produto.priceCents,
      priceFormatted: formatBRL(produto.priceCents),
      isAvailable: produto.isAvailable,
      isFeatured: produto.isFeatured,
    };
  }
}
