import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Remove a segunda etapa de uma conta administrativa.
 *
 * Uso:
 *   npx tsx prisma/reset-2fa.ts <email>
 *
 * Depois disso, o login volta a pedir apenas e-mail e senha. Se
 * REQUIRE_ADMIN_2FA estiver ligado (o padrao, e obrigatorio em producao),
 * um perfil OWNER ou MANAGER sera levado ao fluxo de configuracao no
 * proximo acesso, com QR Code novo.
 */

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error('Uso: npx tsx prisma/reset-2fa.ts <email>');
    process.exit(1);
  }

  const admin = await prisma.adminUser.findFirst({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, role: true, totpEnabledAt: true },
  });

  if (!admin) {
    console.error(`Nenhum administrador com o e-mail ${email}`);
    process.exit(1);
  }

  if (!admin.totpEnabledAt) {
    console.log('');
    console.log(`  ${admin.email} ja estava sem segunda etapa configurada.`);
    console.log('');
    return;
  }

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { totpSecret: null, totpEnabledAt: null },
  });

  /* Sessoes antigas continuariam validas com o 2FA anterior. */
  const revogadas = await prisma.refreshToken.updateMany({
    where: { adminUserId: admin.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  console.log('');
  console.log(`  Segunda etapa removida de ${admin.email} (${admin.role}).`);
  console.log(`  Sessoes encerradas: ${revogadas.count}`);
  console.log('  O proximo login usa apenas e-mail e senha.');
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
