import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminRole, phoneSchema } from '@adventure/shared';
import { z } from 'zod';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public, RequireRole } from '../auth/decorators';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { TEMPLATES, type ChaveDeTemplate } from './whatsapp.templates';
import type { CorpoDoWebhook } from './whatsapp.types';

/** Corpo do envio de teste, usado so pela rota administrativa. */
const envioDeTesteSchema = z
  .object({
    /* phoneSchema do @adventure/shared, e nao um regex proprio: duas
       copias da mesma regra divergem com o tempo, e esta e a mesma
       validacao que o checkout ja usa. */
    phone: phoneSchema,
    /* Sem template = texto livre, que so funciona dentro da janela de
       24h. Com template, o caminho de producao de verdade. */
    template: z.enum(Object.keys(TEMPLATES) as [ChaveDeTemplate, ...ChaveDeTemplate[]]).optional(),
    variaveis: z.array(z.string()).max(10).default([]),
    texto: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((corpo) => Boolean(corpo.template) !== Boolean(corpo.texto), {
    message: 'Informe "template" (com variaveis) OU "texto", nunca os dois',
  });
type EnvioDeTeste = z.infer<typeof envioDeTesteSchema>;

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly webhook: WhatsAppWebhookService,
  ) {}

  /* ============================================================
     WEBHOOK
     ============================================================ */

  /**
   * Verificacao inicial do webhook (hub.challenge).
   *
   * A Meta chama uma unica vez, no cadastro da URL, e espera o
   * `hub.challenge` de volta em TEXTO PURO — devolver JSON faz a
   * verificacao falhar sem explicacao clara no painel deles.
   */
  @Public()
  @Get('webhook')
  verificar(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const resposta = this.webhook.verificarAssinatura(mode, token, challenge);
    if (resposta === null) throw new ForbiddenException('Verificacao recusada');
    return resposta;
  }

  /**
   * Notificacoes de status e mensagens recebidas.
   *
   * SEMPRE responde 200 quando a assinatura e valida, mesmo se o
   * processamento interno falhar: erro faria a Meta reenviar a mesma
   * notificacao indefinidamente. So assinatura invalida vira 401 —
   * essa, sim, pode ser tentativa de forjar evento.
   *
   * Mesmo criterio ja usado no webhook do Mercado Pago.
   */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receber(
    @Req() req: RawBodyRequest<Request>,
    @Body() corpo: CorpoDoWebhook,
    @Headers('x-hub-signature-256') assinatura: string | undefined,
  ): { received: true } {
    /* Assinatura e HMAC do corpo BRUTO: reserializar o JSON parseado
       mudaria espacos e ordem de chaves, e o hash nunca bateria. Ver
       rawBody:true em main.ts. */
    const bruto = req.rawBody?.toString('utf8');

    if (!bruto || !this.webhook.assinaturaConfere(bruto, assinatura)) {
      throw new UnauthorizedException('Assinatura invalida');
    }

    try {
      const resumo = this.webhook.processar(corpo);
      this.logger.debug(
        `Webhook processado: ${resumo.statuses} status, ${resumo.mensagens} mensagem(ns)`,
      );
    } catch (error) {
      this.logger.error('Falha ao processar webhook do WhatsApp', error as Error);
    }

    return { received: true };
  }

  /* ============================================================
     DIAGNOSTICO (administrativo)
     ============================================================ */

  /**
   * Estado da integracao, sem expor segredo nenhum.
   *
   * Serve para conferir, sem abrir o Railway, se a integracao esta de
   * fato ligada e o que falta configurar.
   */
  @RequireRole(AdminRole.OWNER)
  @Get('status')
  status() {
    const templates = Object.entries(TEMPLATES).map(([chave, definicao]) => ({
      chave,
      nome: definicao.nome,
      categoria: definicao.categoria,
      variaveis: definicao.variaveis,
      emUso: definicao.emUso,
    }));

    return {
      ativo: this.whatsapp.ativo,
      /* Separado de proposito: so vale a pena esperar aprovacao da Meta
         do que o sistema realmente dispara hoje. O resto ja tem o metodo
         de envio pronto, mas so sera acionado quando OrdersService for
         integrado — aprovar antes so gasta tempo de espera. */
      precisaAprovarAgora: templates.filter((t) => t.emUso).map((t) => t.nome),
      templates,
    };
  }

  /**
   * Envio de teste.
   *
   * OWNER: dispara mensagem real para um numero arbitrario e, quando a
   * integracao estiver ligada, gasta conversa cobrada pela Meta. Nao e
   * coisa para cozinha nem entrega. Throttle baixo pelo mesmo motivo.
   *
   * Com WHATSAPP_ENABLED=false devolve `simulado: true` e nada sai — o
   * que ja e util para conferir o payload montado.
   */
  @RequireRole(AdminRole.OWNER)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('teste')
  async teste(@Body(new ZodValidationPipe(envioDeTesteSchema)) corpo: EnvioDeTeste) {
    if (corpo.template) {
      const definicao = TEMPLATES[corpo.template];
      if (corpo.variaveis.length !== definicao.variaveis) {
        throw new BadRequestException(
          `O template "${definicao.nome}" espera ${definicao.variaveis} variavel(is): ` +
            definicao.descricaoDasVariaveis.join(', '),
        );
      }
      return this.whatsapp.sendTemplate(corpo.phone, corpo.template, corpo.variaveis);
    }

    return this.whatsapp.sendText(corpo.phone, corpo.texto!);
  }
}
