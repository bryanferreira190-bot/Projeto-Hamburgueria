import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Inspeciona e, opcionalmente, desbloqueia uma conta administrativa.
 *
 * Uso:
 *   npx tsx prisma/unlock-admin.ts <email>            mostra o estado
 *   npx tsx prisma/unlock-admin.ts <email> --unlock   desbloqueia
 */

const prisma = new PrismaClient();

async function main() {
  const [email, flag] = process.argv.slice(2);

  if (!email) {
    console.error('Uso: npx tsx prisma/unlock-admin.ts <email> [--unlock]');
    process.exit(1);
  }

  const admin = await prisma.adminUser.findFirst({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      failedLoginCount: true,
      lockedUntil: true,
      totpEnabledAt: true,
      lastLoginAt: true,
    },
  });

  if (!admin) {
    console.error(`Nenhum administrador com o e-mail ${email}`);
    process.exit(1);
  }

  const locked = admin.lockedUntil !== null && admin.lockedUntil > new Date();

  console.log('');
  console.log(`  E-mail        : ${admin.email}`);
  console.log(`  Papel         : ${admin.role}`);
  console.log(`  Ativo         : ${admin.isActive ? 'sim' : 'nao'}`);
  console.log(`  Falhas        : ${admin.failedLoginCount}`);
  console.log(
    `  Bloqueio      : ${
      locked
        ? `ate ${admin.lockedUntil?.toISOString()} (${Math.ceil(
            ((admin.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000,
          )} min)`
        : 'nenhum'
    }`,
  );
  console.log(`  2FA           : ${admin.totpEnabledAt ? 'ativo' : 'nao configurado'}`);
  console.log(`  Ultimo acesso : ${admin.lastLoginAt?.toISOString() ?? 'nunca'}`);

  if (flag === '--unlock') {
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    console.log('');
    console.log('  Conta desbloqueada e contador zerado.');
  }

  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
