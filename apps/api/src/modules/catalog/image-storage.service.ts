import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface StoredImage {
  data: Buffer;
  mimeType: string;
  version: number;
}

/**
 * Campos necessarios para saber onde mora a foto de um produto.
 * Todo select que devolve produto para o cliente precisa trazer estes.
 */
export interface ProductImageFields {
  id: string;
  imageUrl: string | null;
  imageMimeType: string | null;
  imageVersion: number;
}

/**
 * ARMAZENAMENTO DAS FOTOS DE PRODUTO
 *
 * Hoje guarda no proprio Postgres. E uma escolha consciente para esta
 * escala (~30 produtos, troca rara, 3 MB por arquivo) que evita depender
 * de servico externo e credencial extra.
 *
 * Todo acesso a foto passa por aqui de proposito: migrar para S3 ou
 * Cloudflare R2 depois significa reescrever SO esta classe, sem tocar
 * no controller nem no frontend. Ver DECISOES.md.
 */
@Injectable()
export class ImageStorageService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Endereco publico da foto. A versao no fim quebra o cache do navegador.
   *
   * Absoluta quando PUBLIC_API_URL esta definida (producao, onde a loja
   * esta em outro dominio); relativa em desenvolvimento, onde o proxy do
   * Vite ja coloca tudo na mesma origem.
   */
  buildPublicUrl(productId: string, version: number): string {
    const caminho = `/api/v1/catalog/products/${productId}/image?v=${version}`;
    return this.env.PUBLIC_API_URL ? `${this.env.PUBLIC_API_URL}${caminho}` : caminho;
  }

  /**
   * URL da foto de um produto, decidida a partir da linha do banco.
   *
   * A URL NAO e gravada em coluna de proposito: ela carrega o dominio da
   * API, e dominio muda (staging, troca de provedor). Guardar a origem da
   * foto — bytes no banco ou arquivo estatico do seed — e recalcular o
   * endereco na leitura mantem o banco valido em qualquer ambiente.
   */
  resolveUrl(product: ProductImageFields): string | null {
    /* mimeType so existe quando a foto foi de fato enviada pelo painel. */
    if (product.imageMimeType) return this.buildPublicUrl(product.id, product.imageVersion);

    /* Sobra o caminho estatico que veio do seed inicial (ou nada). */
    return product.imageUrl;
  }

  async save(productId: string, data: Buffer, mimeType: string): Promise<string> {
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        /* O campo Bytes do Prisma espera Uint8Array; Buffer herda dele,
           mas o TypeScript trata os dois como incompativeis por causa do
           SharedArrayBuffer. A conversao aqui e so de tipo, sem copia. */
        imageData: new Uint8Array(data),
        imageMimeType: mimeType,
        imageVersion: { increment: 1 },
      },
      select: { id: true, imageVersion: true },
    });

    return this.buildPublicUrl(updated.id, updated.imageVersion);
  }

  /**
   * Tira a foto do produto.
   *
   * Limpa tambem o imageUrl do seed: quem apagou a foto pelo painel quer
   * o produto sem foto, nao o produto de volta com a foto antiga do seed.
   * A versao sobe junto para invalidar o cache de quem ja tinha carregado.
   */
  async remove(productId: string): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        imageData: null,
        imageMimeType: null,
        imageUrl: null,
        imageVersion: { increment: 1 },
      },
    });
  }

  async load(productId: string): Promise<StoredImage | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { imageData: true, imageMimeType: true, imageVersion: true },
    });

    if (!product?.imageData || !product.imageMimeType) return null;

    return {
      data: Buffer.from(product.imageData),
      mimeType: product.imageMimeType,
      version: product.imageVersion,
    };
  }
}
