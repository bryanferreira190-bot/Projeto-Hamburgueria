import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [orders, customers, admins, products, zones, coupons] = await Promise.all([
    prisma.order.count(),
    prisma.customer.count(),
    prisma.adminUser.count(),
    prisma.product.count(),
    prisma.deliveryZone.count(),
    prisma.coupon.count(),
  ]);

  console.log('Pedidos:', orders);
  console.log('Clientes:', customers);
  console.log('Administradores:', admins);
  console.log('Produtos:', products);
  console.log('Zonas de entrega:', zones);
  console.log('Cupons:', coupons);

  const list = await prisma.adminUser.findMany({ select: { email: true, role: true } });
  console.log('Contas admin:', JSON.stringify(list));
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
