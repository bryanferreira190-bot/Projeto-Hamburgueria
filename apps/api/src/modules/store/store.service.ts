import { Injectable, NotFoundException } from '@nestjs/common';
import { STORE_TIMEZONE } from '../../common/timezone';
import { PrismaService } from '../../infra/prisma/prisma.service';

const WEEKDAY_NAMES = [
  'domingo',
  'segunda-feira',
  'terca-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sabado',
] as const;

export interface StoreStatus {
  isOpen: boolean;
  reason: 'OPEN' | 'BEFORE_OPENING' | 'AFTER_CLOSING' | 'CLOSED_TODAY' | 'PAUSED';
  message: string;
  serverTime: string;
  today: { weekday: number; opensAt: string | null; closesAt: string | null };
  schedule: { weekday: number; label: string; opensAt: string | null; closesAt: string | null }[];
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  minOrderCents: number;
  avgPrepMinutes: number;
}

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Decide se a loja esta aberta AGORA.
   *
   * Esta e a autoridade sobre o assunto. A landing tem a mesma logica em JS,
   * mas ela e apenas visual — qualquer um pode alterar no navegador. Nenhum
   * pedido pode ser aceito sem passar por aqui.
   */
  async getStatus(): Promise<StoreStatus> {
    const store = await this.prisma.store.findFirst({
      include: { businessHours: { orderBy: { weekday: 'asc' } } },
    });

    if (!store) {
      throw new NotFoundException('Loja nao configurada');
    }

    const now = this.nowInStoreTimezone();
    const today = store.businessHours.find((hour) => hour.weekday === now.weekday);

    const schedule = store.businessHours.map((hour) => ({
      weekday: hour.weekday,
      label: WEEKDAY_NAMES[hour.weekday] ?? '',
      opensAt: hour.isClosed ? null : toHHMM(hour.opensAt),
      closesAt: hour.isClosed ? null : toHHMM(hour.closesAt),
    }));

    const base = {
      serverTime: new Date().toISOString(),
      today: {
        weekday: now.weekday,
        opensAt: today && !today.isClosed ? toHHMM(today.opensAt) : null,
        closesAt: today && !today.isClosed ? toHHMM(today.closesAt) : null,
      },
      schedule,
      acceptsDelivery: store.acceptsDelivery,
      acceptsPickup: store.acceptsPickup,
      minOrderCents: store.minOrderCents,
      avgPrepMinutes: store.avgPrepMinutes,
    };

    /* Pausa manual vence o horario: usada quando a cozinha satura. */
    if (!store.isOpenOverride) {
      return {
        ...base,
        isOpen: false,
        reason: 'PAUSED',
        message: 'Estamos temporariamente sem aceitar pedidos.',
      };
    }

    if (!today || today.isClosed) {
      return {
        ...base,
        isOpen: false,
        reason: 'CLOSED_TODAY',
        message: this.nextOpeningMessage(store.businessHours, now.weekday),
      };
    }

    if (now.minutes < today.opensAt) {
      return {
        ...base,
        isOpen: false,
        reason: 'BEFORE_OPENING',
        message: `Abrimos hoje as ${toHHMM(today.opensAt)}.`,
      };
    }

    if (now.minutes >= today.closesAt) {
      return {
        ...base,
        isOpen: false,
        reason: 'AFTER_CLOSING',
        message: this.nextOpeningMessage(store.businessHours, now.weekday),
      };
    }

    return {
      ...base,
      isOpen: true,
      reason: 'OPEN',
      message: `Estamos abertos ate as ${toHHMM(today.closesAt)}.`,
    };
  }

  /** Extrai dia da semana e minutos do dia no fuso da loja, sem dependencia externa. */
  private nowInStoreTimezone(): { weekday: number; minutes: number } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: STORE_TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(new Date());
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const hour = Number(get('hour')) % 24;
    return {
      weekday: weekdayMap[get('weekday')] ?? 0,
      minutes: hour * 60 + Number(get('minute')),
    };
  }

  private nextOpeningMessage(
    hours: { weekday: number; opensAt: number; isClosed: boolean }[],
    currentWeekday: number,
  ): string {
    for (let ahead = 1; ahead <= 7; ahead++) {
      const weekday = (currentWeekday + ahead) % 7;
      const day = hours.find((hour) => hour.weekday === weekday && !hour.isClosed);
      if (day) {
        const when = ahead === 1 ? 'amanha' : WEEKDAY_NAMES[weekday];
        return `Abrimos ${when} as ${toHHMM(day.opensAt)}.`;
      }
    }
    return 'Consulte nossos horarios de funcionamento.';
  }
}

/** Minutos desde a meia-noite para "HH:MM". */
function toHHMM(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
