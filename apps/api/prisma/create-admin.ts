import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { adminPasswordSchema } from '@adventure/shared';

/**
 * Cria (ou atualiza) um administrador.
 *
 * Uso:
 *   npx tsx prisma/create-admin.ts <email> <nome> [OWNER|MANAGER|KITCHEN|DELIVERY]
 *
 * Sem senha no argumento, uma senha forte e gerada e exibida uma unica vez.
 * Passar senha por linha de comando a deixaria no historico do shell.
 */

const prisma = new PrismaClient();

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Gera senha aleatoria que satisfaz a politica do painel. */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;

  const pick = (set: string) => set[randomBytes(1)[0]! % set.length]!;

  /* Garante ao menos um de cada classe exigida. */
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const rest = Array.from({ length: 14 }, () => pick(all));

  return [...required, ...rest].sort(() => (randomBytes(1)[0]! % 2 === 0 ? 1 : -1)).join('');
}

async function main() {
  const [email, name, roleArg] = process.argv.slice(2);

  if (!email || !name) {
    console.error('Uso: npx tsx prisma/create-admin.ts <email> <nome> [papel]');
    process.exit(1);
  }

  const role = (roleArg ?? 'OWNER').toUpperCase() as 'OWNER' | 'MANAGER' | 'KITCHEN' | 'DELIVERY';
  if (!['OWNER', 'MANAGER', 'KITCHEN', 'DELIVERY'].includes(role)) {
    console.error(`Papel invalido: ${role}`);
    process.exit(1);
  }

  const store = await prisma.store.findFirst();
  if (!store) {
    console.error('Nenhuma loja cadastrada. Rode o seed antes: npm run db:seed');
    process.exit(1);
  }

  const password = generatePassword();

  /* Confere que a senha gerada passa na mesma politica exigida do usuario. */
  const check = adminPasswordSchema.safeParse(password);
  if (!check.success) {
    throw new Error('Senha gerada nao satisfaz a politica — revise generatePassword()');
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const admin = await prisma.adminUser.upsert({
    where: { storeId_email: { storeId: store.id, email: email.toLowerCase() } },
    update: { name, role, passwordHash, isActive: true, failedLoginCount: 0, lockedUntil: null },
    create: { storeId: store.id, name, email: email.toLowerCase(), role, passwordHash },
  });

  console.log('');
  console.log('  Administrador pronto');
  console.log('  ------------------------------------------------');
  console.log(`  Nome   : ${admin.name}`);
  console.log(`  E-mail : ${admin.email}`);
  console.log(`  Papel  : ${admin.role}`);
  console.log(`  Senha  : ${password}`);
  console.log('  ------------------------------------------------');
  console.log('  Anote a senha: ela nao sera exibida novamente.');

  if (role === 'OWNER' || role === 'MANAGER') {
    console.log('  Este papel exige 2FA. Configure em POST /auth/admin/totp/setup');
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha ao criar administrador:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
