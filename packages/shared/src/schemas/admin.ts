import { z } from 'zod';
import { AdminRole } from '../domain/enums.js';
import { emailSchema, uuidSchema } from './common.js';

/**
 * Politica de senha do painel.
 *
 * O comprimento minimo e 12, e nao 8: com hash forte, o tamanho e o que
 * realmente encarece um ataque de forca bruta. As classes de caractere
 * existem para barrar senha trivial, mas nao substituem o comprimento.
 */
export const adminPasswordSchema = z
  .string()
  .min(12, 'A senha precisa de ao menos 12 caracteres')
  .max(128, 'A senha e longa demais')
  .refine((value) => /[a-z]/.test(value), 'Inclua ao menos uma letra minuscula')
  .refine((value) => /[A-Z]/.test(value), 'Inclua ao menos uma letra maiuscula')
  .refine((value) => /\d/.test(value), 'Inclua ao menos um numero');

export const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/** Codigo de 6 digitos do app autenticador. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'O codigo tem 6 digitos');

export const adminTotpLoginSchema = z.object({
  challengeToken: z.string().min(1),
  code: totpCodeSchema,
});
export type AdminTotpLoginInput = z.infer<typeof adminTotpLoginSchema>;

export const adminEnableTotpSchema = z.object({
  code: totpCodeSchema,
});
export type AdminEnableTotpInput = z.infer<typeof adminEnableTotpSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual'),
    newPassword: adminPasswordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'A nova senha deve ser diferente da atual',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createAdminSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: emailSchema,
  password: adminPasswordSchema,
  role: z.nativeEnum(AdminRole),
});
export type CreateAdminInput = z.infer<typeof createAdminSchema>;

export const updateAdminSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(2).max(120).optional(),
  role: z.nativeEnum(AdminRole).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAdminInput = z.infer<typeof updateAdminSchema>;

/**
 * Hierarquia de papeis. Numero maior significa mais privilegio.
 * Usada pelo guard para permitir que um papel superior acesse rota de inferior.
 */
export const ROLE_LEVEL: Record<AdminRole, number> = {
  DELIVERY: 1,
  KITCHEN: 2,
  MANAGER: 3,
  OWNER: 4,
};

export function hasRoleLevel(role: AdminRole, required: AdminRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[required];
}

/** Segunda etapa e obrigatoria para quem mexe em dinheiro e configuracao. */
export const ROLES_REQUIRING_TOTP: readonly AdminRole[] = [AdminRole.OWNER, AdminRole.MANAGER];

export function requiresTotp(role: AdminRole): boolean {
  return ROLES_REQUIRING_TOTP.includes(role);
}
