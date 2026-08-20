/** Mascaras apenas de exibicao; a API sempre recebe somente digitos. */

export function mascararTelefone(value: string): string {
  let digits = value.replace(/\D/g, '');
  /* Numero colado em formato internacional ("+55 11 99999-9999", 13
     digitos): sem isto, limitar a 11 digitos cortaria o final do numero
     e o "55" viraria DDD por engano. */
  if (digits.length === 13 && digits.startsWith('55')) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function mascararCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
