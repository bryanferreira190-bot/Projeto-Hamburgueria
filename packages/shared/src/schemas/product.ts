import { z } from 'zod';
import { centsSchema } from './common.js';

/**
 * EDICAO DE PRODUTO PELO PAINEL
 *
 * Todos os campos sao opcionais: o formulario envia apenas o que mudou,
 * entao salvar so o preco nao apaga a descricao sem querer.
 */
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2, 'O nome precisa de ao menos 2 caracteres').max(160).optional(),
    description: z
      .string()
      .trim()
      .max(600, 'A descricao passou de 600 caracteres')
      /* String vazia significa "apagar a descricao", e nao "nao mexer". */
      .or(z.literal(''))
      .optional(),
    priceCents: centsSchema
      .min(1, 'O preco precisa ser maior que zero')
      .max(100_000_00, 'Preco acima do limite')
      .optional(),
    isAvailable: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Nenhuma alteracao enviada',
  });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/* ---------------- Regras da foto ---------------- */

/**
 * Limites do upload. Ficam aqui, em @adventure/shared, para a mensagem
 * exibida no formulario e a validacao feita no servidor virem sempre da
 * mesma fonte — sem risco de o front prometer 3 MB e a API recusar em 2 MB.
 */
export const PRODUCT_IMAGE = {
  /** Quadrada: e assim que o cartao do cardapio exibe. */
  recommendedWidth: 800,
  recommendedHeight: 800,
  maxBytes: 3 * 1024 * 1024,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

export const PRODUCT_IMAGE_HINT =
  'Quadrada, 800 x 800 px. JPG, PNG ou WEBP, ate 3 MB. Fundo escuro combina melhor com o site.';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Valida o arquivo antes de gastar upload. Usada no navegador e na API. */
export function validateProductImage(file: { size: number; type: string }): string | null {
  if (!PRODUCT_IMAGE.acceptedMimeTypes.includes(file.type as never)) {
    return 'Formato nao aceito. Envie JPG, PNG ou WEBP.';
  }
  if (file.size > PRODUCT_IMAGE.maxBytes) {
    return `A imagem tem ${formatBytes(file.size)}. O limite e ${formatBytes(PRODUCT_IMAGE.maxBytes)}.`;
  }
  return null;
}
