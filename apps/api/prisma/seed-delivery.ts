import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Zonas de entrega e cupons de exemplo.
 *
 * Separado do seed principal porque estes dados sao operacionais: a loja
 * ajusta bairros, taxas e promocoes com frequencia, enquanto o cardapio
 * vem da landing.
 */

const prisma = new PrismaClient();

const ZONES = [
  { name: 'Cidade Nova', district: 'Cidade Nova', feeCents: 500, etaMinutes: 35, minOrderCents: 0 },
  { name: 'Centro', district: 'Centro', feeCents: 700, etaMinutes: 45, minOrderCents: 0 },
  { name: 'Vila Nova', district: 'Vila Nova', feeCents: 900, etaMinutes: 50, minOrderCents: 3000 },
  { name: 'Brasil', district: 'Brasil', feeCents: 1200, etaMinutes: 60, minOrderCents: 4000 },
];

const COUPONS = [
  {
    code: 'BEMVINDO10',
    description: '10% de desconto na primeira compra',
    discountType: 'PERCENT' as const,
    discountValue: 10,
    maxDiscountCents: 1500,
    minOrderCents: 3000,
    usageLimit: null,
    perCustomerLimit: 1,
  },
  {
    code: 'FRETEGRATIS',
    description: 'R$ 5,00 de desconto',
    discountType: 'FIXED' as const,
    discountValue: 500,
    maxDiscountCents: null,
    minOrderCents: 5000,
    usageLimit: 100,
    perCustomerLimit: 1,
  },
  {
    code: 'EXPIRADO',
    description: 'Cupom vencido, para testar a validacao',
    discountType: 'PERCENT' as const,
    discountValue: 50,
    maxDiscountCents: null,
    minOrderCents: 0,
    usageLimit: null,
    perCustomerLimit: 1,
    endsAt: new Date('2020-01-01'),
  },
];

async function main() {
  const store = await prisma.store.findFirst();
  if (!store) {
    console.error('Nenhuma loja cadastrada. Rode antes: npm run db:seed');
    process.exit(1);
  }

  for (const zone of ZONES) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { storeId: store.id, district: zone.district },
    });

    if (existing) {
      await prisma.deliveryZone.update({ where: { id: existing.id }, data: zone });
    } else {
      await prisma.deliveryZone.create({ data: { storeId: store.id, ...zone } });
    }
  }
  console.log(`Zonas de entrega: ${ZONES.length}`);

  for (const coupon of COUPONS) {
    await prisma.coupon.upsert({
      where: { storeId_code: { storeId: store.id, code: coupon.code } },
      update: { ...coupon, usageCount: 0, isActive: true },
      create: { storeId: store.id, ...coupon },
    });
  }
  console.log(`Cupons: ${COUPONS.length}`);

  console.log('');
  for (const zone of ZONES) {
    console.log(
      `  ${zone.district.padEnd(14)} R$ ${(zone.feeCents / 100).toFixed(2).padStart(6)}  ${zone.etaMinutes} min`,
    );
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
