import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Configuracao do Prisma.
 *
 * Substitui a chave `prisma` do package.json, descontinuada e removida na v7.
 * O `dotenv/config` no topo garante que DATABASE_URL seja lida do .env tambem
 * nos comandos de CLI (migrate, studio, seed).
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
