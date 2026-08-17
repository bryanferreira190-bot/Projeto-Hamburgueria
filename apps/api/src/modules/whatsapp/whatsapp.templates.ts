/**
 * CATALOGO DE TEMPLATES
 *
 * Mensagem iniciada pela loja EXIGE template aprovado pela Meta. Texto
 * livre so e permitido dentro da janela de 24h depois de o CLIENTE ter
 * mandado mensagem — nenhum aviso daqui se encaixa nisso (todos partem
 * da loja, a qualquer momento).
 *
 * Este arquivo e o CONTRATO com a Meta: cada `nome` abaixo precisa
 * existir, com esse nome exato e nessa ordem de variaveis, no WhatsApp
 * Manager. Se o template for aprovado com outro nome ou com as
 * variaveis em outra ordem, a mensagem chega errada ou e recusada.
 *
 * Por que constante e nao variavel de ambiente: o nome do template faz
 * parte do contrato com a Meta, igual ao nome de uma coluna do banco.
 * Transformar em env daria sete variaveis novas para configurar e ainda
 * assim seria possivel errar — e o erro so apareceria na hora do envio.
 * Aqui, pelo menos, o texto esperado fica versionado junto do codigo.
 *
 * O texto abaixo em `exemplo` e o que deve ser submetido a aprovacao.
 * Ver README.md deste modulo para o passo a passo.
 */

export interface DefinicaoDeTemplate {
  /** Nome exato a registrar no WhatsApp Manager. */
  nome: string;
  /** Categoria a escolher na submissao. */
  categoria: 'UTILITY' | 'MARKETING';
  /** Quantas variaveis o corpo usa. Confere com o envio, em runtime. */
  variaveis: number;
  /** Texto exato a submeter, com {{n}} nas posicoes das variaveis. */
  exemplo: string;
  /** O que cada {{n}} recebe, na ordem. */
  descricaoDasVariaveis: string[];
  /**
   * Se algum ponto do sistema realmente dispara este template hoje.
   *
   * Existe para nao mandar ninguem gastar dias esperando aprovacao da
   * Meta de template que nenhuma linha de codigo chama. Os metodos de
   * envio ja existem no WhatsAppService, mas so serao acionados quando
   * OrdersService/PaymentsService forem integrados — ate la, `false`.
   */
  emUso: boolean;
}

/**
 * UTILITY vs MARKETING importa no bolso: a Meta cobra por conversa e
 * marketing e mais caro, alem de exigir opt-in explicito. Avisos sobre
 * um pedido que a pessoa acabou de fazer sao utilitarios; lembrar de
 * cashback prestes a vencer e promocional, por mais util que pareca.
 */
export const TEMPLATES = {
  PEDIDO_RECEBIDO: {
    nome: 'pedido_recebido',
    categoria: 'UTILITY',
    variaveis: 3,
    exemplo: 'Oi {{1}}! Recebemos seu pedido {{2}} no valor de {{3}}. Já vamos preparar! 🍔',
    descricaoDasVariaveis: ['primeiro nome', 'numero do pedido', 'valor total'],
    emUso: false,
  },
  PAGAMENTO_APROVADO: {
    nome: 'pagamento_aprovado',
    categoria: 'UTILITY',
    variaveis: 2,
    exemplo: 'Boa, {{1}}! O pagamento do pedido {{2}} foi aprovado. Já entrou na fila da cozinha.',
    descricaoDasVariaveis: ['primeiro nome', 'numero do pedido'],
    emUso: false,
  },
  PAGAMENTO_RECUSADO: {
    nome: 'pagamento_recusado',
    categoria: 'UTILITY',
    variaveis: 2,
    exemplo:
      'Oi {{1}}, o pagamento do pedido {{2}} não foi aprovado. Tente outro cartão ou pague com PIX.',
    descricaoDasVariaveis: ['primeiro nome', 'numero do pedido'],
    emUso: false,
  },
  EM_PREPARO: {
    nome: 'pedido_em_preparo',
    categoria: 'UTILITY',
    variaveis: 2,
    exemplo: '{{1}}, seu pedido {{2}} entrou na chapa agora! 👨‍🍳',
    descricaoDasVariaveis: ['primeiro nome', 'numero do pedido'],
    emUso: false,
  },
  SAIU_PARA_ENTREGA: {
    nome: 'pedido_saiu_entrega',
    categoria: 'UTILITY',
    variaveis: 2,
    exemplo: '{{1}}, seu pedido {{2}} saiu para entrega! 🛵 Já já chega aí.',
    descricaoDasVariaveis: ['primeiro nome', 'numero do pedido'],
    emUso: false,
  },
  ENTREGUE: {
    nome: 'pedido_entregue',
    categoria: 'UTILITY',
    variaveis: 2,
    exemplo: '{{1}}, seu pedido {{2}} foi entregue. Bom apetite! 🍔',
    descricaoDasVariaveis: ['primeiro nome', 'numero do pedido'],
    emUso: false,
  },
  CASHBACK_EXPIRANDO: {
    nome: 'cashback_expirando',
    /* Promocional: nao trata de um pedido em andamento, e sim de trazer
       o cliente de volta. Classificar como UTILITY seria contornar a
       regra da Meta e arriscar reprovacao do template. */
    categoria: 'MARKETING',
    variaveis: 2,
    exemplo: 'Oi {{1}}! Seu cashback de {{2}} na Adventure Burguer expira amanhã. Aproveite! 🍔',
    descricaoDasVariaveis: ['primeiro nome', 'valor do cashback'],
    /* UNICO template disparado hoje: CashbackExpiryJob, todo dia as 10h.
       E, portanto, o unico que precisa estar aprovado para a integracao
       comecar a funcionar de fato. */
    emUso: true,
  },
} as const satisfies Record<string, DefinicaoDeTemplate>;

/** Templates que algum ponto do sistema realmente dispara hoje. */
export const TEMPLATES_EM_USO = Object.values(TEMPLATES).filter((t) => t.emUso);

export type ChaveDeTemplate = keyof typeof TEMPLATES;

/** Idioma dos templates. Precisa bater com o registrado na Meta. */
export const IDIOMA_DOS_TEMPLATES = 'pt_BR';
