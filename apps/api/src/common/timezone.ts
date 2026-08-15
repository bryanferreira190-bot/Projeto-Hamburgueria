/**
 * Fuso da operacao. O servidor pode rodar em UTC (e no Railway, roda); o
 * "dia" que importa para o negocio — horario de funcionamento, numeracao
 * de pedido — e sempre o dia local da loja, nunca o UTC do servidor.
 *
 * Fica num lugar so de proposito: duas contas de "hoje" divergentes (uma
 * em UTC, outra no fuso certo) foi a causa de um bug real — a numeracao
 * de pedido reiniciava num limite de dia diferente do horario de
 * funcionamento, e um pedido criado perto da meia-noite UTC (21h em
 * Brasilia) podia colidir com o numero de um pedido do dia anterior. Ver
 * DECISOES.md.
 */
export const STORE_TIMEZONE = 'America/Sao_Paulo';

/**
 * "Hoje" no fuso da loja, como Date de meia-noite UTC — o formato que
 * colunas `@db.Date` do Prisma esperam tanto para gravar quanto para
 * filtrar (`where`). Um Date comum, feito com `new Date()`, carregaria
 * hora e fuso do momento da chamada; aqui so o dia calendario importa.
 */
export function hojeNoFusoDaLoja(agora: Date = new Date()): Date {
  /* en-CA formata como YYYY-MM-DD nativamente — evita montar a string na
     mao. "new Date('YYYY-MM-DD')" interpreta a string como meia-noite
     UTC, que e exatamente o que uma coluna so-de-data precisa. */
  const dataTexto = new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TIMEZONE }).format(agora);
  return new Date(dataTexto);
}
