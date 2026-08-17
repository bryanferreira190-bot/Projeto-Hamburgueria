import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const SECRET_A = 'a'.repeat(48);
const SECRET_B = 'b'.repeat(48);
const SECRET_C = 'c'.repeat(48);

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@host.neon.tech/db?sslmode=require',
  JWT_ACCESS_SECRET: SECRET_A,
  JWT_REFRESH_SECRET: SECRET_B,
  ENCRYPTION_KEY: SECRET_C,
  CORS_ORIGINS: 'http://localhost:4000, http://localhost:5173',
};

describe('loadEnv', () => {
  it('aceita um ambiente valido e aplica os padroes', () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3333);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(env.LOGIN_LOCK_MINUTES).toBe(15);
  });

  it('separa e limpa a lista de origens do CORS', () => {
    const env = loadEnv(validEnv);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4000', 'http://localhost:5173']);
  });

  it('recusa segredo curto demais', () => {
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: 'curto' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...validEnv, ENCRYPTION_KEY: 'curto' })).toThrow(/ENCRYPTION_KEY/);
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

  it('impede reaproveitar o mesmo segredo em producao', () => {
    /* Se access e refresh compartilham segredo, um refresh token passa a
       valer como access token. */
    expect(() =>
      loadEnv({ ...validEnv, NODE_ENV: 'production', JWT_REFRESH_SECRET: SECRET_A }),
    ).toThrow(/distintos/);
  });

  it('aceita producao com segredos distintos e CORS definido', () => {
    const env = loadEnv({ ...validEnv, NODE_ENV: 'production' });
    expect(env.NODE_ENV).toBe('production');
  });

  it('permite desligar o 2FA em desenvolvimento', () => {
    const env = loadEnv({ ...validEnv, REQUIRE_ADMIN_2FA: 'false' });
    expect(env.REQUIRE_ADMIN_2FA).toBe(false);
  });

  it('IGNORA a tentativa de desligar o 2FA em producao', () => {
    /* A conta OWNER controla faturamento e cadastro: senha sozinha nao basta,
       e o .env de producao nao pode enfraquecer isso por engano. */
    const env = loadEnv({ ...validEnv, NODE_ENV: 'production', REQUIRE_ADMIN_2FA: 'false' });
    expect(env.REQUIRE_ADMIN_2FA).toBe(true);
  });

  it('exige 2FA por padrao quando a variavel nao existe', () => {
    expect(loadEnv(validEnv).REQUIRE_ADMIN_2FA).toBe(true);
  });

  it('respeita limites customizados de bloqueio', () => {
    const env = loadEnv({ ...validEnv, LOGIN_MAX_ATTEMPTS: '3', LOGIN_LOCK_MINUTES: '30' });
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(3);
    expect(env.LOGIN_LOCK_MINUTES).toBe(30);
  });

  it('deixa PUBLIC_API_URL vazia quando nao informada', () => {
    /* Vazia significa "devolva caminho relativo", que e o que serve o
       desenvolvimento, onde o proxy do Vite une front e API. */
    expect(loadEnv(validEnv).PUBLIC_API_URL).toBe('');
  });

  it('remove a barra final de PUBLIC_API_URL', () => {
    /* Sem isso a concatenacao com o caminho geraria "site//api/v1/...". */
    const env = loadEnv({ ...validEnv, PUBLIC_API_URL: 'https://api.impactdev.site/' });
    expect(env.PUBLIC_API_URL).toBe('https://api.impactdev.site');
  });

  it('recusa PUBLIC_API_URL que nao seja uma URL completa', () => {
    expect(() => loadEnv({ ...validEnv, PUBLIC_API_URL: 'api.impactdev.site' })).toThrow(
      /PUBLIC_API_URL/,
    );
  });

  describe('WhatsApp', () => {
    it('vem desligado por padrao', () => {
      expect(loadEnv(validEnv).WHATSAPP_ENABLED).toBe(false);
    });

    it('desligado nao exige credencial nenhuma', () => {
      expect(() => loadEnv({ ...validEnv, WHATSAPP_ENABLED: 'false' })).not.toThrow();
    });

    it('ligado SEM credencial derruba o boot em vez de simular em silencio', () => {
      /* Sem isso, errar o nome de uma variavel no Railway faria o
         sistema subir "funcionando" e nunca enviar nada — o dono so
         descobriria pela reclamacao de um cliente. */
      expect(() => loadEnv({ ...validEnv, WHATSAPP_ENABLED: 'true' })).toThrow(
        /WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID/,
      );
    });

    it('ligado com apenas metade das credenciais tambem derruba, dizendo o que falta', () => {
      expect(() =>
        loadEnv({ ...validEnv, WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'tok' }),
      ).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
    });

    it('ligado com as credenciais sobe normalmente', () => {
      const env = loadEnv({
        ...validEnv,
        WHATSAPP_ENABLED: 'true',
        WHATSAPP_ACCESS_TOKEN: 'tok',
        WHATSAPP_PHONE_NUMBER_ID: '123',
      });
      expect(env.WHATSAPP_ENABLED).toBe(true);
    });

    it('a versao da API tem padrao e recusa formato invalido', () => {
      expect(loadEnv(validEnv).WHATSAPP_API_VERSION).toBe('v23.0');
      expect(() => loadEnv({ ...validEnv, WHATSAPP_API_VERSION: '23' })).toThrow(/vXX\.Y/);
    });
  });
});
