import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const SECRET = 'a'.repeat(48);

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@host.neon.tech/db?sslmode=require',
  JWT_ACCESS_SECRET: SECRET,
  JWT_REFRESH_SECRET: SECRET,
  CORS_ORIGINS: 'http://localhost:4000, http://localhost:5173',
};

describe('loadEnv', () => {
  it('aceita um ambiente valido e aplica os padroes', () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3333);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
  });

  it('separa e limpa a lista de origens do CORS', () => {
    const env = loadEnv(validEnv);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4000', 'http://localhost:5173']);
  });

  it('recusa segredo curto demais', () => {
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: 'curto' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('recusa DATABASE_URL ausente', () => {
    const { DATABASE_URL: _omitted, ...semBanco } = validEnv;
    expect(() => loadEnv(semBanco)).toThrow(/DATABASE_URL/);
  });

  it('impede subir em producao com segredo de exemplo', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'trocar_este_valor_em_producao_access_xxxxxxxx',
      }),
    ).toThrow(/valor de exemplo/);
  });

  it('impede subir em producao sem CORS configurado', () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: 'production', CORS_ORIGINS: '' })).toThrow(
      /CORS_ORIGINS/,
    );
  });
});
