/**
 * DADOS DE CARGA INICIAL
 *
 * Nomes, descricoes, imagens e categorias sao lidos automaticamente do
 * apps/landing/index.html — assim nao existe cardapio digitado duas vezes.
 *
 * Este arquivo guarda apenas o que NAO esta na landing: precos, horarios e
 * dados da loja. Os precos vieram dos prints do WhatsMenu enviados no inicio
 * do projeto.
 */

/** Preco em centavos, indexado pelo slug (derivado do nome do arquivo da foto). */
export const PRICES_IN_CENTS: Record<string, number> = {
  // ---------- Classicos ----------
  'classic-burguer': 2800,
  'bacon-burguer': 3200,
  'salada-burguer': 3000,
  'american-burguer': 3200,
  'doritos-burguer': 3500,
  'stacker-burguer': 3500,
  'onions-burguer': 3500,
  'bacon-cheddar': 3500,
  'especial-cheddar': 3500,
  'chicken-burguer': 3400,

  // ---------- Especiais ----------
  'duplo-bacon': 3800,
  'duplo-cheddar': 4000,
  'triplo-cheddar': 4700,
  'adventure-40': 5500,

  // ---------- Combos ----------
  'combo-classic': 4390,
  'combo-bacon': 4790,
  'combo-doritos': 5090,
  'combo-stacker': 5090,
  'combo-chicken': 4990,
  'combo-40': 7090,

  // ---------- Porcoes ----------
  // A landing agrupa tamanhos num card so; usamos o MENOR preco como
  // preco de entrada. Os tamanhos viram grupos de opcoes mais adiante.
  batata: 1290,
  'batata-cheddar-bacon': 2490,
  'onion-rings': 2990,
  'maionese-da-casa': 400,

  // ---------- Bebidas ----------
  // Mesma logica: o card representa a familia, o preco e o do item de entrada.
  refrigerantes: 700,
  cervejas: 800,
  energeticos: 1200,
};

/**
 * Produtos cujo card na landing representa uma familia de itens com tamanhos
 * ou sabores diferentes. Ficam registrados aqui para o painel sinalizar que
 * ainda precisam de grupos de opcoes.
 */
export const GROUPED_PRODUCTS = new Set([
  'batata',
  'batata-cheddar-bacon',
  'onion-rings',
  'refrigerantes',
  'cervejas',
  'energeticos',
]);

/** Metadados das categorias. A chave e o data-cat usado no HTML da landing. */
export const CATEGORIES = [
  { key: 'classicos', name: 'Burguers Classicos', slug: 'burguers-classicos', position: 1 },
  { key: 'especiais', name: 'Burguers Especiais', slug: 'burguers-especiais', position: 2 },
  { key: 'combos', name: 'Combos', slug: 'combos', position: 3 },
  { key: 'porcoes', name: 'Porcoes', slug: 'porcoes', position: 4 },
  { key: 'bebidas', name: 'Bebidas', slug: 'bebidas', position: 5 },
] as const;

/**
 * Horario de funcionamento, em minutos desde a meia-noite.
 * Espelha a tabela HORARIOS de apps/landing/assets/js/main.js.
 * 0 = domingo ... 6 = sabado
 */
export const BUSINESS_HOURS = [
  { weekday: 0, opensAt: 18 * 60, closesAt: 22 * 60 + 30, isClosed: false },
  { weekday: 1, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 2, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 3, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 4, opensAt: 18 * 60, closesAt: 22 * 60 + 30, isClosed: false },
  { weekday: 5, opensAt: 18 * 60, closesAt: 22 * 60 + 30, isClosed: false },
  { weekday: 6, opensAt: 17 * 60, closesAt: 22 * 60 + 30, isClosed: false },
] as const;

/**
 * Dados da loja.
 * ATENCAO: endereco e telefone sao provisorios — substituir pelos reais.
 */
export const STORE = {
  name: 'Adventure Burguer',
  slug: 'adventure-burguer',
  phone: '11000000000',
  whatsapp: '11000000000',
  zipCode: '13300000',
  street: 'Rua a definir',
  number: 'S/N',
  district: 'Cidade Nova',
  city: 'Itu',
  state: 'SP',
  minOrderCents: 0,
  baseDeliveryFeeCents: 500,
  avgPrepMinutes: 30,
} as const;
