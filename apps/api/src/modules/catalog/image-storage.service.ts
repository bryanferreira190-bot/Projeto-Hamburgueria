import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface StoredImage {
  data: Buffer;
  mimeType: string;
  version: number;
}

/**
 * ARMAZENAMENTO DAS FOTOS DE PRODUTO
 *
 * Hoje guarda no proprio Postgres. E uma escolha consciente para esta
 * escala (~30 produtos, troca rara, 2 MB por arquivo) que evita depender
 * de servico externo e credencial extra.
 *
 * Todo acesso a foto passa por aqui de proposito: migrar para S3 ou
 * Cloudflare R2 depois significa reescrever SO esta classe, sem tocar
 * no controller nem no frontend. Ver DECISOES.md.
 */
@Injectable()
export class ImageStorageService {
  constructor(private readonly prisma: PrismaService) {}

  /** Endereco publico da foto. A versao no fim quebra o cache do navegador. */
  buildPublicUrl(productId: string, version: number): string {
    return `/api/v1/catalog/products/${productId}/image?v=${version}`;
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

    const imageUrl = this.buildPublicUrl(updated.id, updated.imageVersion);

    /* imageUrl e gravado depois porque so agora sabemos a versao nova. */
    await this.prisma.product.update({
      where: { id: productId },
      data: { imageUrl },
    });

    return imageUrl;
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
