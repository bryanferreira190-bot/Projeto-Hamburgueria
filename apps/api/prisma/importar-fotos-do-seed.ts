import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Move para o banco as fotos que o seed inicial deixou como arquivo
 * estatico da landing.
 *
 * Ate agora um produto podia ter a foto em dois lugares: os bytes no
 * banco (quando alguem enviou pelo painel) ou um caminho apontando para
 * /assets/img/produtos/*.jpg, servido pela landing. Isso obrigava a loja
 * a saber de dois dominios diferentes so para exibir o cardapio.
 *
 * Depois deste script a API passa a ser a unica dona das fotos, e toda
 * imageUrl do cardapio aponta para /api/v1/catalog/products/:id/image.
 *
 * E seguro rodar mais de uma vez: produtos que ja tem foto no banco sao
 * pulados, entao nada que foi enviado pelo painel e sobrescrito.
 *
 * Uso: npx tsx prisma/importar-fotos-do-seed.ts
 *      npx tsx prisma/importar-fotos-do-seed.ts --forcar
 */

const prisma = new PrismaClient();

/** Onde a landing guarda as fotos originais. */
const PASTA_DAS_FOTOS = path.resolve(__dirname, '../../landing');

const TIPOS_POR_EXTENSAO: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function main() {
  const forcar = process.argv.includes('--forcar');

  const produtos = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true, name: true, imageUrl: true, imageMimeType: true },
    orderBy: { name: 'asc' },
  });

  let importados = 0;
  let pulados = 0;
  const problemas: string[] = [];

  console.log('');

  for (const produto of produtos) {
    if (produto.imageMimeType && !forcar) {
      pulados += 1;
      continue;
    }

    /* Sem caminho estatico nao ha o que importar: ou o produto nunca teve
       foto, ou ela ja veio do painel. */
    if (!produto.imageUrl || produto.imageUrl.startsWith('/api/')) {
      pulados += 1;
      continue;
    }

    const extensao = path.extname(produto.imageUrl).toLowerCase();
    const mimeType = TIPOS_POR_EXTENSAO[extensao];

    if (!mimeType) {
      problemas.push(`${produto.slug}: extensao "${extensao}" nao suportada`);
      continue;
    }

    /* imageUrl comeca com "/", que o path.join trataria como raiz do disco. */
    const arquivo = path.join(PASTA_DAS_FOTOS, produto.imageUrl.replace(/^\/+/, ''));

    let bytes: Buffer;
    try {
      bytes = await readFile(arquivo);
    } catch {
      problemas.push(`${produto.slug}: arquivo nao encontrado em ${arquivo}`);
      continue;
    }

    await prisma.product.update({
      where: { id: produto.id },
      data: {
        imageData: new Uint8Array(bytes),
        imageMimeType: mimeType,
        imageVersion: { increment: 1 },
        /* A URL passa a ser calculada na leitura pelo ImageStorage; deixar
           o caminho antigo aqui so criaria duvida sobre qual vale. */
        imageUrl: null,
      },
    });

    importados += 1;
    console.log(`  ok  ${produto.name} (${Math.round(bytes.length / 1024)} KB)`);
  }

  console.log('');
  console.log(`  ${importados} foto(s) importada(s) para o banco.`);
  console.log(`  ${pulados} produto(s) pulado(s) (ja tinham foto no banco ou nao tinham foto).`);

  if (problemas.length > 0) {
    console.log('');
    console.log(`  ${problemas.length} produto(s) sem foto — o cardapio continua funcionando,`);
    console.log('  esses cartoes so ficam com o icone padrao:');
    for (const problema of problemas) console.log(`    - ${problema}`);
  }

  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
