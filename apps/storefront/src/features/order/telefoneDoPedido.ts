/**
 * Lembra, so nesta aba/sessao, qual telefone foi usado em cada pedido —
 * para a pessoa nao ter que digitar de novo ao ser redirecionada do
 * checkout direto para /pedido/:number.
 *
 * sessionStorage (nao localStorage) de proposito: some ao fechar a aba.
 * Nao e um "lembrar de mim" — e so uma conveniencia para nao pedir a
 * mesma informacao duas vezes na mesma visita.
 */

function chave(numero: string): string {
  return `pedido:${numero.toUpperCase()}:telefone`;
}

export function salvarTelefoneDoPedido(numero: string, telefone: string): void {
  sessionStorage.setItem(chave(numero), telefone.replace(/\D/g, ''));
}

export function lerTelefoneDoPedido(numero: string): string | null {
  return sessionStorage.getItem(chave(numero));
}

export function esquecerTelefoneDoPedido(numero: string): void {
  sessionStorage.removeItem(chave(numero));
}
