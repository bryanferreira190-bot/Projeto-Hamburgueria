import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Abre ou restaura o horario de funcionamento — util para testar em
 * qualquer hora do dia sem esperar o expediente real.
 *
 * Uso:
 *   npx tsx prisma/toggle-hours.ts open      abre 24h todos os dias
 *   npx tsx prisma/toggle-hours.ts restore   volta ao horario real
 */

const prisma = new PrismaClient();

/** Grade real, espelhando apps/landing/assets/js/main.js. */
const REAL_HOURS = [
  { weekday: 0, opensAt: 1080, closesAt: 1350, isClosed: false },
  { weekday: 1, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 2, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 3, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 4, opensAt: 1080, closesAt: 1350, isClosed: false },
  { weekday: 5, opensAt: 1080, closesAt: 1350, isClosed: false },
  { weekday: 6, opensAt: 1020, closesAt: 1350, isClosed: false },
];

async function main() {
  const mode = process.argv[2];
  const store = await prisma.store.findFirst();
  if (!store) {
    console.error('Nenhuma loja cadastrada.');
    process.exit(1);
  }

  if (mode === 'open') {
    for (let weekday = 0; weekday < 7; weekday++) {
      await prisma.businessHour.upsert({
        where: { storeId_weekday: { storeId: store.id, weekday } },
        update: { opensAt: 0, closesAt: 1439, isClosed: false },
        create: { storeId: store.id, weekday, opensAt: 0, closesAt: 1439, isClosed: false },
      });
    }
    console.log('Loja aberta 24h em todos os dias (modo de teste).');
    return;
  }

  if (mode === 'restore') {
    for (const hour of REAL_HOURS) {
      await prisma.businessHour.upsert({
        where: { storeId_weekday: { storeId: store.id, weekday: hour.weekday } },
        update: hour,
        create: { storeId: store.id, ...hour },
      });
    }
    console.log('Horario real restaurado.');
    return;
  }

  console.error('Uso: npx tsx prisma/toggle-hours.ts <open|restore>');
  process.exit(1);
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
