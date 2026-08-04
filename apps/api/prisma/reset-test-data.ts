import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Limpa pedidos e clientes de teste, sem tocar no cardapio nem nas
 * contas de administrador reais.
 *
 * Uso:
 *   npx tsx prisma/reset-test-data.ts           mostra o que seria apagado
 *   npx tsx prisma/reset-test-data.ts --confirm  apaga de verdade
 *
 * O que e removido:
 *   - Todos os pedidos (e, em cascata, itens, adicionais, historico e pagamentos)
 *   - Todos os clientes
 *   - Contagem de uso dos cupons volta a zero
 *
 * O que NUNCA e tocado:
 *   - Produtos, categorias, grupos de opcao
 *   - Contas de administrador (exceto as listadas em TEST_ADMIN_EMAILS)
 *   - Zonas de entrega e os cupons em si (so o contador de uso)
 */

const prisma = new PrismaClient();

/** Contas criadas so para testar RBAC durante o desenvolvimento. */
const TEST_ADMIN_EMAILS = ['entregador@adventureburguer.com.br'];

async function main() {
  const confirmar = process.argv.includes('--confirm');

  const [orders, customers, testAdmins] = await Promise.all([
    prisma.order.count(),
    prisma.customer.count(),
    prisma.adminUser.findMany({
      where: { email: { in: TEST_ADMIN_EMAILS } },
      select: { id: true, email: true, role: true },
    }),
  ]);

  console.log('');
  console.log('  Sera removido:');
  console.log(`    Pedidos           : ${orders}`);
  console.log(`    Clientes          : ${customers}`);
  console.log(
    `    Contas de teste   : ${testAdmins.map((a) => a.email).join(', ') || '(nenhuma)'}`,
  );
  console.log('');
  console.log('  NAO sera tocado: produtos, categorias, zonas de entrega, cupons,');
  console.log('  demais contas de administrador.');
  console.log('');

  if (!confirmar) {
    console.log('  Simulacao apenas. Rode com --confirm para apagar de verdade.');
    console.log('');
    return;
  }

  /* Order tem onDelete:Cascade para item/adicional/historico/pagamento,
     mas Customer tem onDelete:Restrict em relacao a Order — por isso
     pedidos precisam sair primeiro. */
  const deletedOrders = await prisma.order.deleteMany({});
  const deletedCustomers = await prisma.customer.deleteMany({});

  await prisma.coupon.updateMany({ data: { usageCount: 0 } });

  if (testAdmins.length > 0) {
    await prisma.adminUser.deleteMany({ where: { id: { in: testAdmins.map((a) => a.id) } } });
  }

  console.log('  Concluido:');
  console.log(`    ${deletedOrders.count} pedido(s) removido(s)`);
  console.log(`    ${deletedCustomers.count} cliente(s) removido(s)`);
  console.log(`    ${testAdmins.length} conta(s) de teste removida(s)`);
  console.log('    Contador de uso dos cupons zerado');
  console.log('');
}

main()
  .catch((error) => {
    console.error('Falha:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
