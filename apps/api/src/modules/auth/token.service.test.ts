import { describe, expect, it } from 'vitest';
import { parseDuration } from './token.service';

describe('parseDuration', () => {
  it('converte as unidades suportadas', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('24h')).toBe(86_400_000);
    expect(parseDuration('7d')).toBe(604_800_000);
  });

  it('ignora espacos em volta', () => {
    expect(parseDuration('  15m  ')).toBe(900_000);
  });

  it('recusa formato invalido em vez de assumir um padrao', () => {
    /* Silenciosamente assumir um valor faria um token expirar na hora errada. */
    expect(() => parseDuration('15minutos')).toThrow(/Duracao invalida/);
    expect(() => parseDuration('abc')).toThrow(/Duracao invalida/);
    expect(() => parseDuration('')).toThrow(/Duracao invalida/);
    expect(() => parseDuration('15')).toThrow(/Duracao invalida/);
  });
});
