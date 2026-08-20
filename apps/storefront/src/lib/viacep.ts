/**
 * Busca de endereco pelo CEP (ViaCEP), so para preencher o formulario mais
 * rapido. Nunca e a fonte de verdade do endereco: os campos continuam
 * editaveis, e o cliente pode corrigir ou completar manualmente qualquer
 * coisa que a consulta nao trouxer (CEP sem nome de rua, fora do ar, etc.).
 */

export interface EnderecoPorCep {
  street: string;
  district: string;
  city: string;
  state: string;
}

export class CepError extends Error {}

export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoPorCep> {
  let response: Response;
  try {
    response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  } catch {
    throw new CepError('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
  }

  if (!response.ok) {
    throw new CepError('Não foi possível consultar o CEP agora. Preencha o endereço manualmente.');
  }

  const data = (await response.json()) as {
    erro?: boolean;
    logradouro?: string;
    bairro?: string;
    localidade?: string;
    uf?: string;
  };

  /* ViaCEP devolve HTTP 200 com { erro: true } para CEP inexistente, em
     vez de um status de erro — precisa ser checado no corpo. */
  if (data.erro) {
    throw new CepError('CEP não encontrado. Confira o número ou preencha o endereço manualmente.');
  }

  return {
    street: data.logradouro ?? '',
    district: data.bairro ?? '',
    city: data.localidade ?? '',
    state: data.uf ?? '',
  };
}
