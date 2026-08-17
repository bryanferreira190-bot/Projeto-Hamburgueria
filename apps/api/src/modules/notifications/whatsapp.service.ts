import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

export interface MensagemDeTemplate {
  /** Telefone do destinatario, so digitos com DDD (ex.: 11970706978). */
  telefone: string;
  /** Nome exato do template aprovado na Meta. */
  template: string;
  /**
   * Valores que preenchem os {{1}}, {{2}}... do template, na ordem.
   * A Meta so aceita variaveis nesta forma posicional.
   */
  variaveis: string[];
}

/**
 * ENVIO DE WHATSAPP PELA CLOUD API OFICIAL DA META
 *
 * Por que oficial e nao Baileys/Venom: bibliotecas nao oficiais violam
 * os termos do WhatsApp e levam a banimento do numero comercial — o
 * numero que a loja usa para atender cliente. Decisao ja registrada em
 * ARQUITETURA.md desde o inicio do projeto.
 *
 * DORMENTE SEM CREDENCIAL, de proposito: sem WHATSAPP_TOKEN e
 * WHATSAPP_PHONE_NUMBER_ID configurados, `configurado` e false e nada e
 * enviado — so fica registrado no log o que TERIA sido enviado. Isso
 * permite todo o resto do cashback (creditar, resgatar, o job diario)
 * rodar e ser testado em producao antes de a conta Meta estar pronta,
 * sem nenhum "if" espalhado pelo codigo de negocio.
 *
 * MENSAGEM INICIADA PELA LOJA EXIGE TEMPLATE APROVADO. Texto livre so e
 * permitido dentro da janela de 24h depois de o CLIENTE mandar mensagem
 * — o aviso de cashback expirando nao se encaixa nisso (parte da loja,
 * a qualquer momento). Por isso esta classe so envia template.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  get configurado(): boolean {
    return Boolean(this.env.WHATSAPP_TOKEN && this.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  /**
   * Envia uma mensagem de template. Devolve true se a Meta aceitou.
   *
   * Nunca lanca: quem chama e um job em segundo plano, e uma falha de
   * envio nao pode derrubar o processamento dos outros clientes da fila.
   */
  async enviarTemplate(mensagem: MensagemDeTemplate): Promise<boolean> {
    if (!this.configurado) {
      this.logger.warn(
        `WhatsApp nao configurado — mensagem NAO enviada para ${mascarar(mensagem.telefone)} ` +
          `(template "${mensagem.template}", variaveis: ${mensagem.variaveis.join(' | ')})`,
      );
      return false;
    }

    /* O 55 e obrigatorio: a Meta trabalha com o numero em formato
       internacional, e o telefone e guardado so com DDD. */
    const destino = `55${mensagem.telefone.replace(/\D/g, '')}`;

    try {
      const resposta = await fetch(
        `https://graph.facebook.com/v21.0/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: destino,
            type: 'template',
            template: {
              name: mensagem.template,
              language: { code: 'pt_BR' },
              components: mensagem.variaveis.length
                ? [
                    {
                      type: 'body',
                      parameters: mensagem.variaveis.map((texto) => ({ type: 'text', text: texto })),
                    },
                  ]
                : [],
            },
          }),
        },
      );

      if (!resposta.ok) {
        const corpo = await resposta.text();
        this.logger.error(
          `Meta recusou a mensagem para ${mascarar(mensagem.telefone)} ` +
            `(HTTP ${resposta.status}): ${corpo.slice(0, 300)}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Falha de rede ao enviar WhatsApp para ${mascarar(mensagem.telefone)}`,
        error as Error,
      );
      return false;
    }
  }
}

/**
 * Telefone em log vira "11*****6978".
 *
 * Log de aplicacao costuma ser lido por mais gente (e guardado por mais
 * tempo) do que o banco — nao ha motivo para o numero completo do
 * cliente circular por ali so para depurar um envio. Ver a auditoria de
 * LGPD em DECISOES.md.
 */
function mascarar(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length < 6) return '***';
  return `${digitos.slice(0, 2)}*****${digitos.slice(-4)}`;
}
