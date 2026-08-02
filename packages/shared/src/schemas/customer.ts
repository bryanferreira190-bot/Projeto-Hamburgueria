import { z } from 'zod';
import { cepSchema, emailSchema, phoneSchema, uuidSchema } from './common.js';

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O codigo tem 6 digitos'),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const customerProfileSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: emailSchema.optional(),
});
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  zipCode: cepSchema,
  street: z.string().trim().min(2, 'Informe a rua').max(160),
  number: z.string().trim().min(1, 'Informe o numero').max(20),
  complement: z.string().trim().max(120).optional(),
  district: z.string().trim().min(2, 'Informe o bairro').max(120),
  city: z.string().trim().min(2, 'Informe a cidade').max(120),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'UF deve ter 2 letras')
    .regex(/^[A-Z]{2}$/, 'UF invalida'),
  /* Ponto de referencia reduz muito a taxa de entrega mal sucedida. */
  reference: z.string().trim().max(160).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const updateAddressSchema = addressSchema.partial().extend({
  id: uuidSchema,
});
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
