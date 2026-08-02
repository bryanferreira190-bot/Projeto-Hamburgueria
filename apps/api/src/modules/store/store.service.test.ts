import { describe, expect, it, vi } from 'vitest';
import { StoreService } from './store.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * O calculo de aberto/fechado e a autoridade sobre aceitar pedido ou nao.
 * Um erro aqui significa pedido entrando com a cozinha fechada.
 */

const BUSINESS_HOURS = [
  { weekday: 0, opensAt: 1080, closesAt: 1350, isClosed: false }, // dom 18:00-22:30
  { weekday: 1, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 2, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 3, opensAt: 0, closesAt: 0, isClosed: true },
  { weekday: 4, opensAt: 1080, closesAt: 1350, isClosed: false },
  { weekday: 5, opensAt: 1080, closesAt: 1350, isClosed: false },
  { weekday: 6, opensAt: 1020, closesAt: 1350, isClosed: false }, // sab 17:00-22:30
];

function makeService(overrides: { isOpenOverride?: boolean } = {}) {
  const prisma = {
    store: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'store-1',
        isOpenOverride: overrides.isOpenOverride ?? true,
        acceptsDelivery: true,
        acceptsPickup: true,
        minOrderCents: 0,
        avgPrepMinutes: 30,
        businessHours: BUSINESS_HOURS,
      }),
    },
  } as unknown as PrismaService;

  return new StoreService(prisma);
}

/** Fixa o relogio num instante em Brasilia (UTC-3). */
function freezeAt(isoUtc: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoUtc));
}

describe('StoreService.getStatus', () => {
  it('abre dentro do horario', async () => {
    freezeAt('2026-08-02T23:00:00Z'); // domingo 20:00 em Brasilia
    const status = await makeService().getStatus();
    expect(status.isOpen).toBe(true);
    expect(status.reason).toBe('OPEN');
    vi.useRealTimers();
  });

  it('fecha antes do horario de abertura', async () => {
    freezeAt('2026-08-02T17:00:00Z'); // domingo 14:00
    const status = await makeService().getStatus();
    expect(status.isOpen).toBe(false);
    expect(status.reason).toBe('BEFORE_OPENING');
    expect(status.message).toContain('18:00');
    vi.useRealTimers();
  });

  it('fecha depois do horario de encerramento', async () => {
    freezeAt('2026-08-03T02:00:00Z'); // domingo 23:00
    const status = await makeService().getStatus();
    expect(status.isOpen).toBe(false);
    expect(status.reason).toBe('AFTER_CLOSING');
    vi.useRealTimers();
  });

  it('fecha em dia sem expediente', async () => {
    freezeAt('2026-08-03T23:00:00Z'); // segunda 20:00
    const status = await makeService().getStatus();
    expect(status.isOpen).toBe(false);
    expect(status.reason).toBe('CLOSED_TODAY');
    vi.useRealTimers();
  });

  it('a pausa manual vence o horario', async () => {
    freezeAt('2026-08-02T23:00:00Z'); // domingo 20:00, dentro do horario
    const status = await makeService({ isOpenOverride: false }).getStatus();
    expect(status.isOpen).toBe(false);
    expect(status.reason).toBe('PAUSED');
    vi.useRealTimers();
  });

  it('fecha exatamente no minuto do fechamento', async () => {
    freezeAt('2026-08-03T01:30:00Z'); // domingo 22:30 em ponto
    const status = await makeService().getStatus();
    expect(status.isOpen).toBe(false);
    vi.useRealTimers();
  });

  it('abre exatamente no minuto de abertura', async () => {
    freezeAt('2026-08-02T21:00:00Z'); // domingo 18:00 em ponto
    const status = await makeService().getStatus();
    expect(status.isOpen).toBe(true);
    vi.useRealTimers();
  });
});
