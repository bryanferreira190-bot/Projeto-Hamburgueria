import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { ImageStorageService } from './image-storage.service';

/**
 * Estes testes cobrem so a decisao de qual endereco a foto recebe — a
 * parte que os tres frontends consomem. Gravar e ler bytes e trabalho do
 * Prisma, entao o banco nao aparece aqui.
 */
function criarServico(publicApiUrl: string): ImageStorageService {
  const env = { PUBLIC_API_URL: publicApiUrl } as Env;
  return new ImageStorageService({} as PrismaService, env);
}

const PRODUTO_ID = '86698901-714b-4499-bd27-b5bb9e925233';

describe('ImageStorageService.resolveUrl', () => {
  it('monta URL absoluta da API quando a foto esta no banco', () => {
    const url = criarServico('https://api.impactdev.site').resolveUrl({
      id: PRODUTO_ID,
      imageUrl: null,
      imageMimeType: 'image/jpeg',
      imageVersion: 3,
    });

    expect(url).toBe(
      `https://api.impactdev.site/api/v1/catalog/products/${PRODUTO_ID}/image?v=3`,
    );
  });

  it('devolve caminho relativo quando PUBLIC_API_URL nao esta configurada', () => {
    const url = criarServico('').resolveUrl({
      id: PRODUTO_ID,
      imageUrl: null,
      imageMimeType: 'image/webp',
      imageVersion: 1,
    });

    expect(url).toBe(`/api/v1/catalog/products/${PRODUTO_ID}/image?v=1`);
  });

  it('prefere a foto do banco mesmo se o caminho do seed continuar gravado', () => {
    /* Rodar o seed de novo reescreve imageUrl com o caminho estatico; a
       foto enviada pelo painel nao pode ser perdida por causa disso. */
    const url = criarServico('https://api.impactdev.site').resolveUrl({
      id: PRODUTO_ID,
      imageUrl: '/assets/img/produtos/classic-burguer.jpg',
      imageMimeType: 'image/jpeg',
      imageVersion: 2,
    });

    expect(url).toContain('/api/v1/catalog/products/');
  });

  it('cai no arquivo estatico do seed enquanto a foto nao foi importada', () => {
    const url = criarServico('https://api.impactdev.site').resolveUrl({
      id: PRODUTO_ID,
      imageUrl: '/assets/img/produtos/classic-burguer.jpg',
      imageMimeType: null,
      imageVersion: 0,
    });

    expect(url).toBe('/assets/img/produtos/classic-burguer.jpg');
  });

  it('devolve null para produto sem foto nenhuma', () => {
    /* O cardapio precisa continuar carregando: o cartao cai no icone padrao. */
    const url = criarServico('https://api.impactdev.site').resolveUrl({
      id: PRODUTO_ID,
      imageUrl: null,
      imageMimeType: null,
      imageVersion: 0,
    });

    expect(url).toBeNull();
  });

  it('troca a URL a cada versao, para o navegador nao servir a foto antiga', () => {
    const servico = criarServico('https://api.impactdev.site');
    const base = { id: PRODUTO_ID, imageUrl: null, imageMimeType: 'image/png' };

    expect(servico.resolveUrl({ ...base, imageVersion: 1 })).not.toBe(
      servico.resolveUrl({ ...base, imageVersion: 2 }),
    );
  });
});
