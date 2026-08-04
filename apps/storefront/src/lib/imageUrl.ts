const API_BASE = import.meta.env['VITE_API_URL'] ?? '/api/v1';

/**
 * Onde moram as fotos que vieram do seed inicial (arquivos estaticos da
 * landing). Em desenvolvimento, o Vite serve a pasta da landing em
 * /landing; em producao aponta para o dominio da landing.
 */
const LANDING_BASE = import.meta.env['VITE_LANDING_URL'] ?? '/landing';

/**
 * Uma foto de produto pode ter duas origens:
 *
 *  1. Enviada pelo painel  -> caminho da propria API (/api/v1/catalog/...)
 *  2. Vinda do seed inicial -> arquivo estatico da landing (/assets/img/...)
 *
 * Elas moram em servidores diferentes em producao, entao o prefixo certo
 * depende da origem. Concentrar isso aqui evita espalhar essa decisao
 * por cada componente que exibe imagem.
 */
export function resolveImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;

  if (imageUrl.startsWith('/api/v1/')) {
    /* Remove o /api/v1 do caminho porque API_BASE ja termina nele. */
    return API_BASE + imageUrl.slice('/api/v1'.length);
  }

  return LANDING_BASE + imageUrl;
}
