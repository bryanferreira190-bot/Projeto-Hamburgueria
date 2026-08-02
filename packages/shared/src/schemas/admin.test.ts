import { describe, expect, it } from 'vitest';
import { AdminRole } from '../domain/enums.js';
import { adminPasswordSchema, hasRoleLevel, requiresTotp } from './admin.js';

describe('hierarquia de papeis', () => {
  it('papel superior acessa rota de papel inferior', () => {
    expect(hasRoleLevel(AdminRole.OWNER, AdminRole.KITCHEN)).toBe(true);
    expect(hasRoleLevel(AdminRole.MANAGER, AdminRole.DELIVERY)).toBe(true);
  });

  it('papel inferior nao acessa rota de papel superior', () => {
    expect(hasRoleLevel(AdminRole.KITCHEN, AdminRole.MANAGER)).toBe(false);
    expect(hasRoleLevel(AdminRole.DELIVERY, AdminRole.OWNER)).toBe(false);
  });

  it('o proprio papel sempre passa', () => {
    for (const role of Object.values(AdminRole)) {
      expect(hasRoleLevel(role, role)).toBe(true);
    }
  });

  it('exige 2FA de quem mexe em dinheiro e configuracao', () => {
    expect(requiresTotp(AdminRole.OWNER)).toBe(true);
    expect(requiresTotp(AdminRole.MANAGER)).toBe(true);
    expect(requiresTotp(AdminRole.KITCHEN)).toBe(false);
    expect(requiresTotp(AdminRole.DELIVERY)).toBe(false);
  });
});

describe('politica de senha', () => {
  it('aceita senha forte', () => {
    expect(adminPasswordSchema.safeParse('CozinhaQuente2026').success).toBe(true);
  });

  it('recusa senha curta', () => {
    const result = adminPasswordSchema.safeParse('Abc12345');
    expect(result.success).toBe(false);
  });

  it('exige maiuscula, minuscula e numero', () => {
    expect(adminPasswordSchema.safeParse('todaminuscula123').success).toBe(false);
    expect(adminPasswordSchema.safeParse('TODAMAIUSCULA123').success).toBe(false);
    expect(adminPasswordSchema.safeParse('SemNumeroAlgum').success).toBe(false);
  });
});
