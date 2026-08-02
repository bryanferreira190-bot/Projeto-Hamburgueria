import { describe, expect, it } from 'vitest';
import { applyPercentDiscount, formatBRL, multiplyCents, sumCents, toCents } from './money.js';

/**
 * Intl.NumberFormat separa "R$" do valor com espaco nao separavel (U+00A0),
 * e nao com espaco comum. Isso e correto: impede a quebra de linha entre o
 * simbolo e o numero.
 *
 * O caractere e construido por codigo, e nao digitado literalmente, porque
 * caractere invisivel em codigo-fonte e fonte de bug dificil de rastrear.
 */
const NBSP = String.fromCharCode(160);
const normalizeSpace = (value: string) => value.replaceAll(NBSP, ' ');

describe('money', () => {
  it('nao acumula erro de ponto flutuante', () => {
    /* Em float, 0.1 + 0.2 !== 0.3. Em centavos, o problema nao existe. */
    expect(sumCents([toCents(0.1), toCents(0.2)])).toBe(30);
  });

  it('soma um pedido real sem centavo perdido', () => {
    const items = [toCents(28), toCents(35), toCents(12.9), toCents(7)];
    expect(sumCents(items)).toBe(8290);
    expect(normalizeSpace(formatBRL(sumCents(items)))).toBe('R$ 82,90');
  });

  it('usa espaco nao separavel, para o valor nao quebrar de linha', () => {
    expect(formatBRL(2800)).toContain(NBSP);
  });

  it('multiplica por quantidade mantendo inteiro', () => {
    expect(multiplyCents(toCents(28.9), 3)).toBe(8670);
  });

  it('arredonda o desconto a favor da loja', () => {
    /* 10% de R$ 28,99 = 289,9 centavos -> trunca para 289. */
    expect(applyPercentDiscount(2899, 10)).toBe(2899 - 289);
  });

  it('trata os extremos do desconto', () => {
    expect(applyPercentDiscount(5000, 0)).toBe(5000);
    expect(applyPercentDiscount(5000, 100)).toBe(0);
  });
});
