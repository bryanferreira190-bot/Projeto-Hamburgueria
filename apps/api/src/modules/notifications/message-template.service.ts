import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationEvent, type NotificationEvent as TNotificationEvent } from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Valores ja formatados prontos para entrar no texto — nunca dado cru. */
export interface PlaceholderContext {
  nome: string;
  pedido: string;
  valor: string;
  status: string;
  telefone: string;
  /** Saldo de cashback do cliente, ja em BRL (ex.: "R$ 12,50"). */
  cashback: string;
  /** Itens do pedido, um por linha (ex.: "2× Bacon Burguer"). Vazio se nao houver pedido por tras do evento. */
  itens: string;
}

/**
 * Texto padrao de cada evento — o que o admin ve na PRIMEIRA vez, antes
 * de editar qualquer coisa. Copiado do pedido original, so trocando os
 * `{{n}}` posicionais da Meta (que exigem aprovacao) pelos placeholders
 * nomeados de texto livre, que a Evolution manda como veio.
 */
const TEXTO_PADRAO: Record<TNotificationEvent, string> = {
  ORDER_RECEIVED:
    '🍔 Pedido recebido!\n\nOlá, {nome}!\n\nRecebemos seu pedido #{pedido}.\n\n{itens}\n\nTotal: {valor}\n\n💰 Seu saldo de cashback: {cashback}\n\nEm breve começaremos o preparo. 😊',
  PAYMENT_APPROVED:
    '✅ Pagamento aprovado!\n\nOlá, {nome}!\n\nO pagamento do pedido #{pedido} foi confirmado.\n\nJá vamos começar a preparar seu pedido. 🍔',
  PREPARING:
    '👨‍🍳 Seu pedido está sendo preparado!\n\nPedido #{pedido}\n\n{itens}\n\nEstamos preparando tudo com cuidado. 🍔',
  READY:
    '🎉 Seu pedido está pronto!\n\nPedido #{pedido}\n\nJá pode ficar de olho — não vai demorar! 🍔',
  OUT_FOR_DELIVERY:
    '🛵 Seu pedido saiu para entrega!\n\nPedido #{pedido}\n\nFique atento, seu lanche está a caminho. 🍔',
  DELIVERED:
    '✅ Pedido entregue!\n\nEsperamos que aproveite seu pedido #{pedido}. 🍔\n\nObrigado pela preferência!',
  CASHBACK_REMINDER:
    'Olá, {nome}! 👋\n\nPassando para lembrar que você possui:\n\n💰 *{cashback} de cashback*\n\ndisponível para utilizar nos seus próximos pedidos na Adventure Burguer. 🍔\n\nAproveite no seu próximo pedido! 😋',
};

/**
 * TEMPLATES DE NOTIFICACAO — CRUD + RENDERIZACAO
 *
 * Guarda o texto de cada evento no banco (por loja), editavel pelo
 * admin sem deploy. Nao tem nada a ver com o catalogo de templates
 * aprovados da Meta (whatsapp.templates.ts) — aquele exige aprovacao e
 * variavel posicional; este e texto livre, porque a Evolution nao tem
 * essa restricao.
 */
@Injectable()
export class MessageTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todos os 5 templates da loja, criando com o texto padrao quem ainda
   * nao existir. Loja nova (ou primeira vez que a tela de admin abre)
   * nunca ve uma lista pela metade.
   */
  async listar(storeId: string) {
    const existentes = await this.prisma.notificationTemplate.findMany({ where: { storeId } });
    const porEvento = new Map(existentes.map((t) => [t.event, t]));

    const faltando = Object.values(NotificationEvent).filter((event) => !porEvento.has(event));
    if (faltando.length > 0) {
      await this.prisma.notificationTemplate.createMany({
        data: faltando.map((event) => ({ storeId, event, message: TEXTO_PADRAO[event] })),
        /* Corrida entre duas chamadas simultaneas (dois admins abrindo a
           tela ao mesmo tempo pela primeira vez): a constraint
           @@unique([storeId, event]) e quem decide, isto so evita o
           erro subir como excecao. */
        skipDuplicates: true,
      });
    }

    return this.prisma.notificationTemplate.findMany({
      where: { storeId },
      orderBy: { event: 'asc' },
    });
  }

  /**
   * Template ATIVO de um evento, ou null se estiver desligado. Cria com
   * o texto padrao se for a primeira vez que este evento e consultado
   * (ex.: pedido mudou de status antes de qualquer admin abrir a tela
   * de configuracao).
   */
  async obterAtivo(storeId: string, event: TNotificationEvent) {
    const existente = await this.prisma.notificationTemplate.findUnique({
      where: { storeId_event: { storeId, event } },
    });
    if (existente) return existente.isActive ? existente : null;

    const criado = await this.prisma.notificationTemplate
      .create({ data: { storeId, event, message: TEXTO_PADRAO[event] } })
      /* Corrida com outra criacao simultanea: quem perdeu so relê o que
         a outra ja gravou, em vez de estourar em P2002. */
      .catch(() =>
        this.prisma.notificationTemplate.findUniqueOrThrow({
          where: { storeId_event: { storeId, event } },
        }),
      );

    return criado.isActive ? criado : null;
  }

  async atualizar(
    storeId: string,
    event: TNotificationEvent,
    dados: { message?: string | undefined; isActive?: boolean | undefined },
  ) {
    await this.obterAtivo(storeId, event); // garante que a linha existe

    /* Prisma nao aceita `undefined` explicito em `data` sob
       exactOptionalPropertyTypes — so inclui as chaves realmente
       informadas, em vez de repassar `dados` como veio. */
    const data: { message?: string; isActive?: boolean } = {};
    if (dados.message !== undefined) data.message = dados.message;
    if (dados.isActive !== undefined) data.isActive = dados.isActive;

    const atualizado = await this.prisma.notificationTemplate.update({
      where: { storeId_event: { storeId, event } },
      data,
    });

    return atualizado;
  }

  async restaurarPadrao(storeId: string, event: TNotificationEvent) {
    const existe = await this.prisma.notificationTemplate.findUnique({
      where: { storeId_event: { storeId, event } },
    });
    if (!existe) throw new NotFoundException('Template nao encontrado');

    return this.prisma.notificationTemplate.update({
      where: { storeId_event: { storeId, event } },
      data: { message: TEXTO_PADRAO[event] },
    });
  }

  /**
   * Substituicao de placeholder SEM regex: `{nome}` e `{}` sao
   * caracteres literais de regex, e montar um pattern dinamico a partir
   * de texto editado por humano abriria espaco para erro de escaping.
   * `split/join` faz o mesmo efeito com string pura.
   */
  renderizar(texto: string, contexto: PlaceholderContext): string {
    const substituicoes: Record<string, string> = {
      '{nome}': contexto.nome,
      '{pedido}': contexto.pedido,
      '{valor}': contexto.valor,
      '{status}': contexto.status,
      '{telefone}': contexto.telefone,
      '{cashback}': contexto.cashback,
      '{itens}': contexto.itens,
    };

    return Object.entries(substituicoes).reduce(
      (atual, [placeholder, valor]) => atual.split(placeholder).join(valor),
      texto,
    );
  }
}
