import { NotificationEvent, OrderStatus } from '@adventure/shared';
import { describe, expect, it, vi } from 'vitest';
import { MessagingService, type OrderNotificationContext } from './messaging.service';
import type { MessageTemplateService } from './message-template.service';
import type { EvolutionWhatsAppProvider } from './providers/evolution-whatsapp.provider';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { Env } from '../../config/env';

/**
 * O contrato mais importante deste servico: `notificar()` NUNCA lanca, e
 * decide corretamente entre simular, pular (idempotencia/template
 * desligado) ou mandar de verdade. Quem chama (OrdersService,
 * PaymentsService) depende disso para nunca travar o fluxo do pedido.
 */

const CONTEXTO: OrderNotificationContext = {
  storeId: 'store-1',
  orderId: 'order-1',
  orderNumber: 'A001',
  customerName: 'Joao da Silva',
  phone: '11970706978',
  totalCents: 3000,
  status: OrderStatus.CONFIRMED,
};

function makeService(opts: {
  provider?: 'evolution' | 'none';
  jaEnviado?: boolean;
  template?: { message: string; isActive: boolean } | null;
  sendResult?: { success: boolean; externalId?: string | null; error?: string };
} = {}) {
  const env = { WHATSAPP_PROVIDER: opts.provider ?? 'evolution' } as Env;

  const notificationLogCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    notificationLog: {
      findFirst: vi.fn().mockResolvedValue(opts.jaEnviado ? { id: 'log-1' } : null),
      create: notificationLogCreate,
    },
  } as unknown as PrismaService;

  const templates = {
    obterAtivo: vi.fn().mockResolvedValue(
      opts.template === undefined
        ? { message: 'Ola {nome}, pedido #{pedido}', isActive: true }
        : opts.template,
    ),
    renderizar: vi.fn((texto: string) => texto.replace('{nome}', 'Joao').replace('{pedido}', 'A001')),
  } as unknown as MessageTemplateService;

  const evolution = {
    nome: 'evolution',
    sendText: vi.fn().mockResolvedValue(opts.sendResult ?? { success: true, externalId: 'wamid-1' }),
    checkHealth: vi.fn().mockResolvedValue({ connected: true }),
  } as unknown as EvolutionWhatsAppProvider;

  const service = new MessagingService(env, prisma, templates, evolution);
  return { service, prisma, templates, evolution, notificationLogCreate };
}

describe('MessagingService.notificar', () => {
  it('WHATSAPP_PROVIDER=none: nunca chama o provedor, devolve simulado', async () => {
    const { service, evolution } = makeService({ provider: 'none' });

    const resultado = await service.notificar(NotificationEvent.ORDER_RECEIVED, CONTEXTO);

    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(resultado).toEqual({ enviado: true, simulado: true });
  });

  it('pedido sem telefone (balcao): pula sem chamar o provedor', async () => {
    const { service, evolution } = makeService();

    const resultado = await service.notificar(NotificationEvent.ORDER_RECEIVED, { ...CONTEXTO, phone: null });

    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(resultado).toEqual({ enviado: false, simulado: false, motivo: 'sem telefone' });
  });

  it('evento ja notificado com sucesso para este pedido: pula (idempotencia)', async () => {
    const { service, evolution } = makeService({ jaEnviado: true });

    const resultado = await service.notificar(NotificationEvent.ORDER_RECEIVED, CONTEXTO);

    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(resultado.enviado).toBe(false);
    expect(resultado.motivo).toBe('ja enviado');
  });

  it('template desativado para o evento: pula sem chamar o provedor', async () => {
    const { service, evolution } = makeService({ template: null });

    const resultado = await service.notificar(NotificationEvent.PREPARING, CONTEXTO);

    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(resultado.motivo).toBe('template desativado');
  });

  it('caminho feliz: renderiza o template, manda pelo provedor e grava log de sucesso', async () => {
    const { service, evolution, notificationLogCreate } = makeService();

    const resultado = await service.notificar(NotificationEvent.ORDER_RECEIVED, CONTEXTO);

    expect(evolution.sendText).toHaveBeenCalledWith('5511970706978', 'Ola Joao, pedido #A001');
    expect(resultado).toEqual({ enviado: true, simulado: false });
    expect(notificationLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        event: NotificationEvent.ORDER_RECEIVED,
        provider: 'evolution',
        success: true,
        errorMessage: null,
      }),
    });
  });

  it('provedor falha: nao lanca, devolve enviado:false e grava log de falha', async () => {
    const { service, notificationLogCreate } = makeService({
      sendResult: { success: false, error: 'HTTP 500' },
    });

    const resultado = await service.notificar(NotificationEvent.ORDER_RECEIVED, CONTEXTO);

    expect(resultado.enviado).toBe(false);
    expect(resultado.motivo).toBe('HTTP 500');
    expect(notificationLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ success: false, errorMessage: 'HTTP 500' }),
    });
  });

  it('erro inesperado (ex.: banco fora do ar) nunca sobe — vira resultado com enviado:false', async () => {
    const { service, prisma } = makeService();
    (prisma.notificationLog.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB fora do ar'));

    await expect(service.notificar(NotificationEvent.ORDER_RECEIVED, CONTEXTO)).resolves.toEqual({
      enviado: false,
      simulado: false,
      motivo: 'erro interno',
    });
  });
});

describe('MessagingService.enviarTeste', () => {
  it('WHATSAPP_PROVIDER=none: simula sem chamar o provedor', async () => {
    const { service, evolution } = makeService({ provider: 'none' });

    const resultado = await service.enviarTeste('11970706978', 'teste');

    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(resultado).toEqual({ enviado: true, simulado: true });
  });

  it('manda o texto exatamente como veio, sem template nem log', async () => {
    const { service, evolution, notificationLogCreate } = makeService();

    const resultado = await service.enviarTeste('11970706978', 'mensagem de teste');

    expect(evolution.sendText).toHaveBeenCalledWith('5511970706978', 'mensagem de teste');
    expect(notificationLogCreate).not.toHaveBeenCalled();
    expect(resultado).toEqual({ enviado: true, simulado: false });
  });
});
