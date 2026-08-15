/**
 * O telefone chega da API somente com digitos (ver `phoneSchema` em
 * @adventure/shared, que normaliza antes de gravar) — a mascara e sempre
 * responsabilidade de quem exibe.
 */

/** "11970706978" -> "(11) 97070-6978" */
export function formatarTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length !== 11) return telefone;

  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

/**
 * Link que abre a conversa com o cliente — aplicativo no celular, WhatsApp
 * Web no computador — sem a loja precisar salvar o contato antes.
 *
 * O `55` na frente e obrigatorio: o wa.me so trabalha com o numero em
 * formato internacional, e o telefone e guardado apenas com DDD.
 */
export function linkDoWhatsApp(telefone: string, mensagem?: string): string {
  const url = `https://wa.me/55${telefone.replace(/\D/g, '')}`;
  return mensagem ? `${url}?text=${encodeURIComponent(mensagem)}` : url;
}
