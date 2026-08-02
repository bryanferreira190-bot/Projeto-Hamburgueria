import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Confere como os dados sensiveis estao gravados: senha em hash Argon2id e
 * segredo TOTP cifrado. Util para auditoria rapida.
 *
 * Uso: npx tsx prisma/inspect-security.ts [segredo-totp-em-claro]
 */

const prisma = new PrismaClient();

async function main() {
  const plainSecret = process.argv[2];

  const admin = await prisma.adminUser.findFirst({
    select: { email: true, totpSecret: true, passwordHash: true },
  });

  if (!admin) {
    console.error('Nenhum administrador cadastrado.');
    process.exit(1);
  }

  console.log('');
  console.log(`  Conta : ${admin.email}`);
  console.log('');

  console.log('  SENHA');
  console.log(`    Gravado    : ${admin.passwordHash.slice(0, 40)}...`);
  console.log(
    `    Algoritmo  : ${admin.passwordHash.startsWith('$argon2id$') ? 'Argon2id' : 'INESPERADO'}`,
  );
  const params = /m=(\d+),t=(\d+),p=(\d+)/.exec(admin.passwordHash);
  if (params) {
    console.log(
      `    Parametros : ${Math.round(Number(params[1]) / 1024)} MiB, ${params[2]} iteracoes, paralelismo ${params[3]}`,
    );
  }

  console.log('');
  console.log('  SEGREDO TOTP');
  if (!admin.totpSecret) {
    console.log('    Nao configurado.');
  } else {
    const parts = admin.totpSecret.split('.');
    console.log(`    Gravado    : ${admin.totpSecret.slice(0, 40)}...`);
    console.log(
      `    Formato    : ${parts.length === 3 ? 'iv.authTag.ciphertext (AES-256-GCM)' : 'INESPERADO'}`,
    );
    if (plainSecret) {
      const leaked = admin.totpSecret.includes(plainSecret);
      console.log(`    Em claro?  : ${leaked ? 'SIM — FALHA GRAVE' : 'nao, cifrado corretamente'}`);
    }
  }

  const tokens = await prisma.refreshToken.findFirst({ select: { tokenHash: true } });
  console.log('');
  console.log('  REFRESH TOKEN');
  console.log(
    tokens
      ? `    Gravado    : ${tokens.tokenHash.slice(0, 40)}... (hash SHA-256, nao o token)`
      : '    Nenhuma sessao ativa.',
  );
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
