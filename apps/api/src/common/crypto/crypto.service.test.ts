import { describe, expect, it } from 'vitest';
import { CryptoService } from './crypto.service';
import type { Env } from '../../config/env';

const env = { ENCRYPTION_KEY: 'x'.repeat(48) } as Env;
const crypto = new CryptoService(env);

describe('CryptoService', () => {
  it('cifra e decifra de volta ao original', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('nunca deixa o texto em claro no resultado', () => {
    const secret = 'SEGREDOSUPERSECRETO';
    expect(crypto.encrypt(secret)).not.toContain(secret);
  });

  it('gera resultado diferente a cada chamada (IV aleatorio)', () => {
    const a = crypto.encrypt('mesmo-valor');
    const b = crypto.encrypt('mesmo-valor');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe(crypto.decrypt(b));
  });

  it('produz o formato iv.authTag.ciphertext', () => {
    expect(crypto.encrypt('teste').split('.')).toHaveLength(3);
  });

  it('recusa payload adulterado — o GCM autentica o conteudo', () => {
    const encrypted = crypto.encrypt('valor-original');
    const [iv, tag, data] = encrypted.split('.');
    const tampered = `${iv}.${tag}.${data!.slice(0, -4)}AAAA`;
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('recusa payload malformado', () => {
    expect(() => crypto.decrypt('sem-pontos')).toThrow(/formato invalido/i);
  });

  it('gera tokens unicos e longos', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => crypto.generateToken()));
    expect(tokens.size).toBe(200);
    expect(crypto.generateToken().length).toBeGreaterThanOrEqual(64);
  });

  it('o hash do token e estavel e nao reversivel', () => {
    const token = crypto.generateToken();
    expect(crypto.hashToken(token)).toBe(crypto.hashToken(token));
    expect(crypto.hashToken(token)).not.toContain(token);
  });

  it('safeEqual compara corretamente', () => {
    expect(crypto.safeEqual('abc', 'abc')).toBe(true);
    expect(crypto.safeEqual('abc', 'abd')).toBe(false);
    expect(crypto.safeEqual('abc', 'abcd')).toBe(false);
  });
});
