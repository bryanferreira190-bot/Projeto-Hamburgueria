import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { BUSINESS_HOURS, CATEGORIES, GROUPED_PRODUCTS, PRICES_IN_CENTS, STORE } from './seed-data';

/**
 * CARGA INICIAL
 *
 * O cardapio e lido do HTML da landing, e nao redigitado aqui. Assim existe
 * uma unica fonte para nome, descricao, foto e categoria de cada produto.
 *
 * O seed e idempotente: rodar varias vezes atualiza, nunca duplica.
 */

const prisma = new PrismaClient();

const LANDING_HTML = path.resolve(__dirname, '../../landing/index.html');

interface ParsedProduct {
  categoryKey: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
  isFeatured: boolean;
}

/** Extrai os cards de produto do HTML da landing. */
function parseProductsFromLanding(): ParsedProduct[] {
  const html = fs.readFileSync(LANDING_HTML, 'utf8');

  const cardPattern =
    /<article class="card([^"]*)" data-cat="([^"]+)">[\s\S]*?<img src="([^"]+)"[^>]*alt="([^"]+)"[\s\S]*?<h3>([^<]+)<\/h3>\s*<p>([\s\S]*?)<\/p>/g;

  const products: ParsedProduct[] = [];
  let match: RegExpExecArray | null;

  while ((match = cardPattern.exec(html)) !== null) {
    const [, cardModifiers, categoryKey, imageUrl, , rawName, rawDescription] = match;
    if (!categoryKey || !imageUrl || !rawName) continue;

    /* O nome do arquivo da foto e o slug canonico do produto. */
    const slug = path.basename(imageUrl, path.extname(imageUrl));

    products.push({
      categoryKey,
      slug,
      name: cleanText(rawName),
      description: cleanText(rawDescription ?? ''),
      imageUrl: `/${imageUrl}`,
      isFeatured: (cardModifiers ?? '').includes('card--wide'),
    });
  }

  return products;
}

/** Remove tags, normaliza espacos e decodifica as entidades usadas na landing. */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('Lendo cardapio de apps/landing/index.html ...');
  const parsed = parseProductsFromLanding();
  console.log(`  ${parsed.length} produtos encontrados\n`);

  if (parsed.length === 0) {
    throw new Error('Nenhum produto extraido da landing. O HTML mudou de formato?');
  }

  // ---------- Loja ----------
  const store = await prisma.store.upsert({
    where: { slug: STORE.slug },
    update: {},
    create: { ...STORE },
  });
  console.log(`Loja: ${store.name} (${store.id})`);

  // ---------- Horarios ----------
  for (const hour of BUSINESS_HOURS) {
    await prisma.businessHour.upsert({
      where: { storeId_weekday: { storeId: store.id, weekday: hour.weekday } },
      update: { opensAt: hour.opensAt, closesAt: hour.closesAt, isClosed: hour.isClosed },
      create: { storeId: store.id, ...hour },
    });
  }
  const openDays = BUSINESS_HOURS.filter((h) => !h.isClosed).length;
  console.log(`Horarios: ${BUSINESS_HOURS.length} dias (${openDays} abertos)`);

  // ---------- Categorias ----------
  const categoryIdByKey = new Map<string, string>();
  for (const category of CATEGORIES) {
    const saved = await prisma.category.upsert({
      where: { storeId_slug: { storeId: store.id, slug: category.slug } },
      update: { name: category.name, position: category.position },
      create: {
        storeId: store.id,
        name: category.name,
        slug: category.slug,
        position: category.position,
      },
    });
    categoryIdByKey.set(category.key, saved.id);
  }
  console.log(`Categorias: ${CATEGORIES.length}`);

  // ---------- Produtos ----------
  const missingPrice: string[] = [];
  let created = 0;
  let updated = 0;

  for (const [index, product] of parsed.entries()) {
    const categoryId = categoryIdByKey.get(product.categoryKey);
    if (!categoryId) {
      console.warn(`  ! categoria desconhecida "${product.categoryKey}" em ${product.slug}`);
      continue;
    }

    const priceCents = PRICES_IN_CENTS[product.slug];
    if (priceCents === undefined) {
      missingPrice.push(product.slug);
      continue;
    }

    const existing = await prisma.product.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: product.slug } },
      select: { id: true },
    });

    await prisma.product.upsert({
      where: { storeId_slug: { storeId: store.id, slug: product.slug } },
      update: {
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        categoryId,
        position: index,
        isFeatured: product.isFeatured,
        /* O preco NAO e sobrescrito: se o admin ajustou, o seed respeita. */
      },
      create: {
        storeId: store.id,
        categoryId,
        name: product.name,
        slug: product.slug,
        description: product.description,
        imageUrl: product.imageUrl,
        priceCents,
        position: index,
        isFeatured: product.isFeatured,
      },
    });

    if (existing) updated++;
    else created++;
  }

  console.log(`Produtos: ${created} criados, ${updated} atualizados`);

  if (missingPrice.length > 0) {
    console.warn(`\n  ATENCAO — sem preco definido em seed-data.ts:`);
    missingPrice.forEach((slug) => console.warn(`    - ${slug}`));
  }

  const grouped = parsed.filter((p) => GROUPED_PRODUCTS.has(p.slug));
  if (grouped.length > 0) {
    console.log(`\n  Produtos que representam familia (preco = item de entrada):`);
    grouped.forEach((p) => console.log(`    - ${p.name}`));
    console.log('  Precisam de grupos de opcoes para tamanho/sabor.');
  }

  // ---------- Resumo ----------
  const totals = await prisma.product.groupBy({
    by: ['categoryId'],
    _count: { _all: true },
    where: { storeId: store.id },
  });

  console.log('\nResumo por categoria:');
  for (const category of CATEGORIES) {
    const id = categoryIdByKey.get(category.key);
    const total = totals.find((t) => t.categoryId === id)?._count._all ?? 0;
    console.log(`  ${category.name.padEnd(22)} ${total}`);
  }
}

main()
  .catch((error) => {
    console.error('\nSeed falhou:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
