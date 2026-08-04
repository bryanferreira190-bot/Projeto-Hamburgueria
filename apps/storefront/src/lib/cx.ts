/**
 * Junta classes ignorando valores falsos.
 *
 * Vive fora de ui.tsx porque um arquivo que exporta componentes E funcoes
 * quebra o hot reload do Vite — a tela recarrega inteira em vez de trocar
 * so o componente editado.
 */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
