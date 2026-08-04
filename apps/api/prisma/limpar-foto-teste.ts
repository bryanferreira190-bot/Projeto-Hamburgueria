import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Devolve um produto a foto original do seed, apagando a que estiver
 * guardada no banco.
 *
 * Uso: npx tsx prisma/limpar-foto-teste.ts <slug>
 */

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];

  if (!slug) {
    console.error('Uso: npx tsx prisma/limpar-foto-teste.ts <slug>');
    process.exit(1);
  }

  const resultado = await prisma.product.updateMany({
    where: { slug },
    data: {
      imageData: null,
      imageMimeType: null,
      imageUrl: `/assets/img/produtos/${slug}.jpg`,
    },
  });

  console.log('');
  console.log(`  ${resultado.count} produto(s) com a foto restaurada para o arquivo do seed.`);
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
