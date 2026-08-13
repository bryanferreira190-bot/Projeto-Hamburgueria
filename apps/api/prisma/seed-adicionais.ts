import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * ADICIONAIS DO LANCHE
 *
 * Cria o grupo "Adicionais" e liga aos produtos que fazem sentido
 * (burguers e combos — ninguem poe bacon num refrigerante).
 *
 * E idempotente: rodar de novo atualiza preco e posicao das opcoes e
 * refaz as ligacoes que faltarem, sem duplicar nada.
 *
 * Uso: npm run db:seed-adicionais
 */

const prisma = new PrismaClient();

const NOME_DO_GRUPO = 'Adicionais';

/** Preco em CENTAVOS. Trocar aqui muda o valor cobrado no pedido. */
const ADICIONAIS = [
  { name: 'Bacon', priceCents: 700 },
  { name: 'Ovo', priceCents: 400 },
  { name: 'Onions', priceCents: 1100 },
  { name: 'Hamburguer', priceCents: 1100 },
  { name: 'Picles', priceCents: 400 },
];

/** So estas categorias recebem os adicionais. */
const CATEGORIAS_COM_ADICIONAIS = ['burguers-classicos', 'burguers-especiais', 'combos'];

/**
 * Teto de adicionais SOMADOS no lanche (nao por tipo).
 *
 * A loja repete o mesmo id para pedir mais de um — "2x bacon" viaja como
 * o id do bacon duas vezes —, entao este numero precisa acomodar
 * repeticao, e nao so a quantidade de opcoes diferentes. Fica abaixo do
 * limite de 30 do orderItemInputSchema.
 */
const MAX_ADICIONAIS_POR_LANCHE = 20;

async function main() {
  const store = await prisma.store.findFirst();
  if (!store) throw new Error('Nenhuma loja cadastrada. Rode o seed antes: npm run db:seed');

  /* ---------- grupo ---------- */
  let grupo = await prisma.optionGroup.findFirst({
    where: { storeId: store.id, name: NOME_DO_GRUPO },
  });

  if (grupo) {
    grupo = await prisma.optionGroup.update({
      where: { id: grupo.id },
      data: { minSelect: 0, maxSelect: MAX_ADICIONAIS_POR_LANCHE, isActive: true },
    });
    console.log(`Grupo "${grupo.name}" ja existia — atualizado.`);
  } else {
    grupo = await prisma.optionGroup.create({
      data: {
        storeId: store.id,
        name: NOME_DO_GRUPO,
        description: 'Turbine seu lanche',
        /* Opcional (min 0), com teto generoso para permitir repeticao. */
        minSelect: 0,
        maxSelect: MAX_ADICIONAIS_POR_LANCHE,
      },
    });
    console.log(`Grupo "${grupo.name}" criado.`);
  }

  /* ---------- opcoes ---------- */
  for (const [indice, adicional] of ADICIONAIS.entries()) {
    const existente = await prisma.option.findFirst({
      where: { optionGroupId: grupo.id, name: adicional.name },
    });

    if (existente) {
      await prisma.option.update({
        where: { id: existente.id },
        data: { priceCents: adicional.priceCents, position: indice, isActive: true },
      });
    } else {
      await prisma.option.create({
        data: {
          optionGroupId: grupo.id,
          name: adicional.name,
          priceCents: adicional.priceCents,
          position: indice,
        },
      });
    }

    console.log(`  ${adicional.name.padEnd(12)} +R$ ${(adicional.priceCents / 100).toFixed(2)}`);
  }

  /* ---------- ligacao com os produtos ---------- */
  const produtos = await prisma.product.findMany({
    where: {
      storeId: store.id,
      deletedAt: null,
      category: { slug: { in: CATEGORIAS_COM_ADICIONAIS } },
    },
    select: { id: true, name: true },
  });

  let ligados = 0;
  for (const produto of produtos) {
    /* createMany com skipDuplicates evita erro quando a ligacao ja existe. */
    const resultado = await prisma.productOptionGroup.createMany({
      data: [{ productId: produto.id, optionGroupId: grupo.id }],
      skipDuplicates: true,
    });
    ligados += resultado.count;
  }

  console.log('');
  console.log(`  ${produtos.length} produto(s) nas categorias ${CATEGORIAS_COM_ADICIONAIS.join(', ')}`);
  console.log(`  ${ligados} ligacao(oes) nova(s) criada(s).`);
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
