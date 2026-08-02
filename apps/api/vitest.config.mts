import { defineConfig } from 'vitest/config';

/**
 * Extensao .mts de proposito: este pacote e CommonJS (exigencia do NestJS),
 * mas o Vitest so carrega como ESM. O .mts isola a configuracao dessa regra.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'prisma/**/*.test.ts'],
    environment: 'node',
  },
});
