import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { formatBRL } from '@adventure/shared';

/** Verificacao de conectividade e amostra do que esta gravado. */
const prisma = new PrismaClient();

async function main() {
  const [store, categories, products, hours] = await Promise.all([
    prisma.store.findFirst(),
    prisma.category.count(),
    prisma.product.count(),
    prisma.businessHour.findMany({ orderBy: { weekday: 'asc' } }),
  ]);

  console.log(`Loja       : ${store?.name} — ${store?.city}/${store?.state}`);
  console.log(`Categorias : ${categories}`);
  console.log(`Produtos   : ${products}`);

  const WEEKDAYS = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
  const toHour = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  console.log('\nHorarios:');
  for (const hour of hours) {
    const label = WEEKDAYS[hour.weekday]?.padEnd(8) ?? '?';
    console.log(
      `  ${label} ${hour.isClosed ? 'Fechado' : `${toHour(hour.opensAt)} - ${toHour(hour.closesAt)}`}`,
    );
  }

  const cheapest = await prisma.product.findMany({
    orderBy: { priceCents: 'asc' },
    take: 3,
    select: { name: true, priceCents: true },
  });
  const priciest = await prisma.product.findMany({
    orderBy: { priceCents: 'desc' },
    take: 3,
    select: { name: true, priceCents: true },
  });

  console.log('\nMais baratos:');
  cheapest.forEach((p) => console.log(`  ${p.name.padEnd(28)} ${formatBRL(p.priceCents)}`));
  console.log('\nMais caros:');
  priciest.forEach((p) => console.log(`  ${p.name.padEnd(28)} ${formatBRL(p.priceCents)}`));

  /* Nenhum preco pode ser zero ou negativo. */
  const invalid = await prisma.product.count({ where: { priceCents: { lte: 0 } } });
  console.log(`\nProdutos com preco invalido: ${invalid}`);
}

main()
  .catch((error) => {
    console.error('Falha ao consultar o banco:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
