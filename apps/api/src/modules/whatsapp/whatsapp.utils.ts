import type { PayloadDeMensagem } from './whatsapp.types';

/**
 * Funcoes puras do modulo — sem estado, sem injecao, sem dependencia de
 * servico.
 *
 * Vivem separadas para o WhatsAppWebhookService poder mascarar telefone
 * sem importar o WhatsAppService inteiro (que arrastaria junto o cliente
 * HTTP, o catalogo de templates e o ambiente). O webhook nao envia nada;
 * nao deveria depender de quem envia.
 */

/**
 * Telefone brasileiro guardado so com DDD vira formato internacional.
 *
 * A Meta so aceita o numero completo com codigo do pais; o banco guarda
 * apenas digitos com DDD (ver phoneSchema). Numero que ja venha com 55
 * na frente nao ganha outro — a guarda de tamanho evita confundir com
 * um DDD 55 (Rio Grande do Sul), que tem 11 digitos, nao 12.
 */
export function paraFormatoInternacional(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.startsWith('55') && digitos.length >= 12) return digitos;
  return `55${digitos}`;
}

/**
 * "5511970706978" -> "*********6978".
 *
 * Mascara TUDO menos os quatro ultimos digitos — o suficiente para
 * conferir "e o mesmo numero?" ao depurar, sem o numero completo do
 * cliente circulando no log.
 */
export function mascararTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length < 6) return '***';
  return `${digitos.slice(0, -4).replace(/./g, '*')}${digitos.slice(-4)}`;
}

/**
 * Versao do payload segura para log.
 *
 * O payload cru carrega o telefone completo em `to` e, nos templates, o
 * nome do cliente nos `parameters` — dado pessoal que nao tem por que
 * ficar no log. Mantem a ESTRUTURA (tipo, nome do template, quantas
 * variaveis), que e o que serve para depurar "por que essa mensagem
 * saiu errada", e troca os valores por marcadores.
 */
export function sanitizarPayload(payload: PayloadDeMensagem): Record<string, unknown> {
  const base = {
    type: payload.type,
    to: mascararTelefone(payload.to),
  };

  if (payload.type === 'template') {
    const parametros = payload.template.components[0]?.parameters ?? [];
    return {
      ...base,
      template: payload.template.name,
      idioma: payload.template.language.code,
      /* Quantidade e tamanho, nunca o conteudo: e o que permite
         diagnosticar "mandei variavel a menos" sem expor o nome de
         ninguem. */
      variaveis: parametros.map((parametro) => `<${parametro.text.length} chars>`),
    };
  }

  return { ...base, tamanhoDoTexto: payload.text.body.length };
}
