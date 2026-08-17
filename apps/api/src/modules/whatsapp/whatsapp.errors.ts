import type { ErroDaMeta, TipoDeErroWhatsApp } from './whatsapp.types';

export interface ErroClassificado {
  tipo: TipoDeErroWhatsApp;
  mensagem: string;
  codigo?: number;
  /**
   * Se vale tentar de novo.
   *
   * A distincao mais importante deste arquivo: repetir um envio com
   * token invalido ou template reprovado nunca vai funcionar, so gasta
   * tempo e polui log. Ja limite de envio e queda de rede passam
   * sozinhos — esses valem espera e nova tentativa.
   */
  podeRepetir: boolean;
}

/**
 * Codigos de erro da Cloud API que precisamos distinguir.
 *
 * A lista NAO e exaustiva de proposito: so entra aqui codigo que muda o
 * que o sistema faz (repetir ou nao) ou que merece mensagem propria no
 * log. Todo o resto cai no ERRO_DA_META generico, sem repeticao.
 *
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const CODIGOS = {
  /* Autenticacao / permissao — nunca adianta repetir. */
  TOKEN_INVALIDO: 190,
  SEM_PERMISSAO: 200,
  APP_SEM_ACESSO: 10,
  /* "Access denied": falta permissao no System User. NAO e
     indisponibilidade — repetir isso queima tentativa a toa e ainda
     aponta o diagnostico para o lado errado. */
  ACESSO_NEGADO: 131005,

  /**
   * Limite de envio.
   *
   * TODOS marcados como NAO repetiveis, apesar do nome: as janelas aqui
   * sao de hora (4), 24h (80007, 131048) ou minutos (131056), e o
   * backoff deste cliente e de ~1,2s no total. Repetir seria gastar 3
   * chamadas garantidamente perdidas. Quem chama deve tentar de novo
   * mais tarde — nao daqui a um segundo.
   */
  LIMITE_DA_APP_POR_HORA: 4,
  LIMITE_DA_CONTA_24H: 80007,
  LIMITE_DE_TAXA: 130429,
  LIMITE_POR_PAR: 131056,
  LIMITE_DE_DESTINATARIOS: 131048,
  /* Devolvido com HTTP 400, entao nao cai no fallback de 429/5xx. */
  LIMITE_DA_API: 613,

  /* Destinatario — o UNICO que realmente significa "nao entregavel". */
  NAO_ENTREGAVEL: 131026,

  /**
   * Numero da PROPRIA LOJA nao registrado na Cloud API (falta concluir
   * o /register). Toda a familia 133xxx e sobre o nosso numero, nao o
   * do cliente — classificar como problema do destinatario faria a
   * pessoa conferir telefone de cliente por horas.
   */
  NOSSO_NUMERO_NAO_REGISTRADO: 133010,
  NOSSO_NUMERO_DESREGISTRANDO: 133015,

  /* Conta / faturamento — o erro mais comum ao ligar a integracao. */
  PROBLEMA_DE_PAGAMENTO: 131042,
  CONTA_BLOQUEADA: 131031,

  /* Janela de 24h: precisa de template. */
  FORA_DA_JANELA: 131047,
  /* A Meta escolheu nao entregar (qualidade/engajamento). Atinge
     principalmente template de MARKETING — no nosso caso, o de
     cashback. Repetir nao muda a decisao deles. */
  META_NAO_ENTREGOU: 131049,

  /* Template. */
  TEMPLATE_NAO_EXISTE: 132001,
  TEMPLATE_PARAMS: 132000,
  TEMPLATE_REPROVADO: 132007,
  TEMPLATE_PAUSADO: 132015,
  TEMPLATE_DESABILITADO: 132016,

  /* Indisponibilidade momentanea de verdade — vale repetir. */
  ERRO_INTERNO: 131000,
  SERVICO_INDISPONIVEL: 131016,
} as const;

/**
 * Traduz a resposta de erro da Meta para algo que o sistema saiba
 * tratar, e que quem le o log entenda sem consultar tabela de codigo.
 */
export function classificarErro(status: number, corpo: ErroDaMeta | null): ErroClassificado {
  const erro = corpo?.error;
  const codigo = erro?.code;
  const detalhe = erro?.error_data?.details ?? erro?.message ?? 'sem detalhe';

  switch (codigo) {
    case CODIGOS.TOKEN_INVALIDO:
    case CODIGOS.SEM_PERMISSAO:
    case CODIGOS.APP_SEM_ACESSO:
    case CODIGOS.ACESSO_NEGADO:
      return {
        tipo: 'CREDENCIAL_INVALIDA',
        mensagem: `Credencial recusada pela Meta (${detalhe}). Confira WHATSAPP_ACCESS_TOKEN e as permissoes whatsapp_business_messaging/management do System User.`,
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.NOSSO_NUMERO_NAO_REGISTRADO:
    case CODIGOS.NOSSO_NUMERO_DESREGISTRANDO:
      return {
        tipo: 'CONFIGURACAO_INVALIDA',
        mensagem: `O NUMERO DA LOJA nao esta registrado na Cloud API (${detalhe}). Conclua o registro no WhatsApp Manager — nao e problema no telefone do cliente.`,
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.PROBLEMA_DE_PAGAMENTO:
    case CODIGOS.CONTA_BLOQUEADA:
      return {
        tipo: 'CONFIGURACAO_INVALIDA',
        mensagem: `Conta WhatsApp Business impedida de enviar (${detalhe}). Confira forma de pagamento e situacao da conta no Meta Business.`,
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.LIMITE_DA_APP_POR_HORA:
    case CODIGOS.LIMITE_DA_CONTA_24H:
    case CODIGOS.LIMITE_DE_TAXA:
    case CODIGOS.LIMITE_POR_PAR:
    case CODIGOS.LIMITE_DE_DESTINATARIOS:
    case CODIGOS.LIMITE_DA_API:
      return {
        tipo: 'LIMITE_EXCEDIDO',
        /* podeRepetir FALSE apesar do nome: estas janelas sao de hora ou
           de 24h, e o backoff aqui e de ~1,2s. Repetir agora so gasta
           chamada — quem precisa e tentar bem mais tarde. */
        mensagem: `Limite de envio da conta atingido (${detalhe}). A janela e de horas — tente novamente mais tarde.`,
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.NAO_ENTREGAVEL:
      return {
        tipo: 'DESTINATARIO_INVALIDO',
        mensagem: `Numero nao recebe no WhatsApp (${detalhe}).`,
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.FORA_DA_JANELA:
      return {
        tipo: 'FORA_DA_JANELA',
        mensagem:
          'Passou da janela de 24h desde a ultima mensagem do cliente — so template aprovado e aceito aqui.',
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.META_NAO_ENTREGOU:
      return {
        tipo: 'RECUSADO_PELA_META',
        mensagem: `A Meta optou por nao entregar esta mensagem (${detalhe}). Costuma atingir template de marketing com baixo engajamento — repetir nao muda a decisao.`,
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.TEMPLATE_NAO_EXISTE:
    case CODIGOS.TEMPLATE_PARAMS:
    case CODIGOS.TEMPLATE_REPROVADO:
    case CODIGOS.TEMPLATE_PAUSADO:
    case CODIGOS.TEMPLATE_DESABILITADO:
      return {
        tipo: 'TEMPLATE_INVALIDO',
        mensagem: `Problema no template (${detalhe}). Confira nome, idioma e quantidade de variaveis no WhatsApp Manager.`,
        codigo,
        podeRepetir: false,
      };

    case CODIGOS.ERRO_INTERNO:
    case CODIGOS.SERVICO_INDISPONIVEL:
      return {
        tipo: 'INDISPONIVEL',
        mensagem: `Meta indisponivel no momento (${detalhe}).`,
        codigo,
        podeRepetir: true,
      };
  }

  /* Sem codigo conhecido: decide pelo status HTTP. 429 e 5xx sao
     transitorios por natureza; o resto nao. */
  if (status === 429) {
    return {
      tipo: 'LIMITE_EXCEDIDO',
      mensagem: `Limite de envio atingido (HTTP 429).`,
      ...(codigo !== undefined ? { codigo } : {}),
      podeRepetir: true,
    };
  }

  if (status >= 500) {
    return {
      tipo: 'INDISPONIVEL',
      mensagem: `Meta respondeu ${status} (${detalhe}).`,
      ...(codigo !== undefined ? { codigo } : {}),
      podeRepetir: true,
    };
  }

  return {
    tipo: 'ERRO_DA_META',
    mensagem: `Meta recusou (HTTP ${status}): ${detalhe}`,
    ...(codigo !== undefined ? { codigo } : {}),
    podeRepetir: false,
  };
}

/** Falha de rede/timeout — nunca chegou a virar resposta da Meta. */
export function erroDeRede(motivo: string): ErroClassificado {
  return {
    tipo: 'INDISPONIVEL',
    mensagem: `Nao foi possivel falar com a Meta: ${motivo}`,
    podeRepetir: true,
  };
}
