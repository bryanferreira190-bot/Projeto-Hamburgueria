import { Injectable, NotFoundException } from '@nestjs/common';
import { formatBRL } from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ImageStorageService } from './image-storage.service';

export interface OptionDto {
  id: string;
  name: string;
  priceCents: number;
  priceFormatted: string;
}

export interface OptionGroupDto {
  id: string;
  name: string;
  /** minSelect > 0 torna o grupo obrigatorio. */
  minSelect: number;
  maxSelect: number;
  options: OptionDto[];
}

export interface ProductDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  priceFormatted: string;
  isAvailable: boolean;
  isFeatured: boolean;
  /** Adicionais que este produto aceita. Vazio quando nao tem nenhum. */
  optionGroups: OptionGroupDto[];
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  position: number;
  products: ProductDto[];
}

/**
 * Colunas do produto que saem para o cliente.
 *
 * Explicito de proposito, por dois motivos: devolver a entidade inteira
 * vazaria custo, margem e datas internas — e, principalmente, traria
 * junto o imageData, que sao os BYTES da foto. Sem esta lista, listar o
 * cardapio arrastaria dezenas de megabytes do banco a cada requisicao.
 */
const CAMPOS_DO_PRODUTO = {
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
  /* Os adicionais vem junto com o cardapio de proposito: a caixa de
     escolha abre a partir do cartao ja carregado, e uma segunda
     requisicao so para listar "bacon, ovo, picles" atrasaria a abertura
     sem necessidade — sao poucas linhas por produto. */
  optionGroups: {
    where: { optionGroup: { isActive: true } },
    orderBy: { position: 'asc' },
    select: {
      optionGroup: {
        select: {
          id: true,
          name: true,
          minSelect: true,
          maxSelect: true,
          options: {
            where: { isActive: true },
            orderBy: { position: 'asc' },
            select: { id: true, name: true, priceCents: true },
          },
        },
      },
    },
  },
} as const;

interface ProductRow {
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
  optionGroups: {
    optionGroup: {
      id: string;
      name: string;
      minSelect: number;
      maxSelect: number;
      options: { id: string; name: string; priceCents: number }[];
    };
  }[];
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageStorageService,
  ) {}

  /** Cardapio completo, agrupado por categoria. */
  async getMenu(): Promise<CategoryDto[]> {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        position: true,
        products: {
          where: { isActive: true, deletedAt: null },
          orderBy: { position: 'asc' },
          select: CAMPOS_DO_PRODUTO,
        },
      },
    });

    return categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      position: category.position,
      products: category.products.map((product) => this.toProductDto(product)),
    }));
  }

  async getProductBySlug(slug: string): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, deletedAt: null },
      select: CAMPOS_DO_PRODUTO,
    });

    if (!product) {
      throw new NotFoundException(`Produto "${slug}" nao encontrado`);
    }

    return this.toProductDto(product);
  }

  /** Destaques da home do storefront. */
  async getFeatured(): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, isFeatured: true, deletedAt: null },
      orderBy: { position: 'asc' },
      take: 8,
      select: CAMPOS_DO_PRODUTO,
    });

    return products.map((product) => this.toProductDto(product));
  }

  private toProductDto(product: ProductRow): ProductDto {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      /* Endereco montado na leitura pelo ImageStorage — ver o porque la. */
      imageUrl: this.images.resolveUrl(product),
      priceCents: product.priceCents,
      /* Formatado no servidor para todos os clientes exibirem igual. */
      priceFormatted: formatBRL(product.priceCents),
      isAvailable: product.isAvailable,
      isFeatured: product.isFeatured,
      optionGroups: product.optionGroups.map(({ optionGroup }) => ({
        id: optionGroup.id,
        name: optionGroup.name,
        minSelect: optionGroup.minSelect,
        maxSelect: optionGroup.maxSelect,
        options: optionGroup.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceCents: option.priceCents,
          priceFormatted: formatBRL(option.priceCents),
        })),
      })),
    };
  }
}
