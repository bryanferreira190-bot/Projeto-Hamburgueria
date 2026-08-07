const API_BASE = import.meta.env['VITE_API_URL'] ?? '/api/v1';

/**
 * Onde moram as fotos que ainda nao foram importadas para o banco
 * (arquivos estaticos da landing). Em desenvolvimento, o Vite serve a
 * pasta da landing em /landing; em producao aponta para o dominio dela.
 */
const LANDING_BASE = import.meta.env['VITE_LANDING_URL'] ?? '/landing';

/**
 * Deixa a foto de um produto pronta para entrar num <img src>.
 *
 * A API e a dona das fotos: desde a importacao das imagens do seed
 * (`prisma/importar-fotos-do-seed.ts`), ela devolve a URL ja completa,
 * e o caso comum aqui e so repassar adiante.
 *
 * Os outros dois ramos existem para nao depender de configuracao:
 *
 *  1. Caminho da propria API ("/api/v1/...") — e o que ela devolve em
 *     desenvolvimento, onde PUBLIC_API_URL fica vazia de proposito
 *     porque o proxy do Vite ja une front e API na mesma origem.
 *  2. Arquivo estatico da landing ("/assets/img/...") — sobra de produto
 *     cuja foto ainda nao foi importada. Some quando o script rodar.
 */
export function resolveImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;

  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  if (imageUrl.startsWith('/api/v1/')) {
    /* Remove o /api/v1 do caminho porque API_BASE ja termina nele. */
    return API_BASE + imageUrl.slice('/api/v1'.length);
  }

  return LANDING_BASE + imageUrl;
}
