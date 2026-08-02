import { Injectable, NotFoundException } from '@nestjs/common';
import { formatBRL } from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

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
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  position: number;
  products: ProductDto[];
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cardapio completo, agrupado por categoria.
   *
   * Os campos expostos sao escolhidos um a um, de proposito: devolver a
   * entidade do Prisma inteira vazaria custo, margem e datas internas.
   */
  async getMenu(): Promise<CategoryDto[]> {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      include: {
        products: {
          where: { isActive: true, deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
    });

    return categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      position: category.position,
      products: category.products.map(toProductDto),
    }));
  }

  async getProductBySlug(slug: string): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(`Produto "${slug}" nao encontrado`);
    }

    return toProductDto(product);
  }

  /** Destaques da home do storefront. */
  async getFeatured(): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, isFeatured: true, deletedAt: null },
      orderBy: { position: 'asc' },
      take: 8,
    });

    return products.map(toProductDto);
  }
}

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  isAvailable: boolean;
  isFeatured: boolean;
}

function toProductDto(product: ProductRow): ProductDto {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    priceCents: product.priceCents,
    /* Formatado no servidor para todos os clientes exibirem igual. */
    priceFormatted: formatBRL(product.priceCents),
    isAvailable: product.isAvailable,
    isFeatured: product.isFeatured,
  };
}
