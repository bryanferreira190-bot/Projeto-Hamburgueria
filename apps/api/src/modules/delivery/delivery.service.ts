import { Injectable, NotFoundException } from '@nestjs/common';
import { formatBRL } from '@adventure/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface DeliveryQuote {
  available: boolean;
  zoneId: string | null;
  zoneName: string | null;
  feeCents: number;
  feeFormatted: string;
  etaMinutes: number;
  minOrderCents: number;
  message: string;
}

@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula a taxa para um bairro.
   *
   * A comparacao ignora acento e caixa: o cliente digita "Cidade nova" e o
   * cadastro tem "Cidade Nova". Sem isso, a zona nao seria encontrada e o
   * pedido cairia na taxa base, cobrando errado.
   */
  async quote(district: string): Promise<DeliveryQuote> {
    const store = await this.prisma.store.findFirst({
      include: { deliveryZones: { where: { isActive: true } } },
    });

    if (!store) throw new NotFoundException('Loja nao configurada');

    if (!store.acceptsDelivery) {
      return {
        available: false,
        zoneId: null,
        zoneName: null,
        feeCents: 0,
        feeFormatted: formatBRL(0),
        etaMinutes: 0,
        minOrderCents: store.minOrderCents,
        message: 'No momento estamos atendendo apenas retirada no balcao.',
      };
    }

    const normalized = normalize(district);
    const zone = store.deliveryZones.find(
      (candidate) => candidate.district && normalize(candidate.district) === normalized,
    );

    if (!zone) {
      /* Sem zona cadastrada, aplica a taxa base da loja. Nao bloqueamos o
         pedido: e melhor atender e ajustar depois do que recusar venda. */
      return {
        available: true,
        zoneId: null,
        zoneName: null,
        feeCents: store.baseDeliveryFeeCents,
        feeFormatted: formatBRL(store.baseDeliveryFeeCents),
        etaMinutes: store.avgPrepMinutes + 20,
        minOrderCents: store.minOrderCents,
        message: 'Taxa padrao aplicada. Confirmaremos o valor pelo WhatsApp.',
      };
    }

    return {
      available: true,
      zoneId: zone.id,
      zoneName: zone.name,
      feeCents: zone.feeCents,
      feeFormatted: formatBRL(zone.feeCents),
      etaMinutes: zone.etaMinutes,
      minOrderCents: Math.max(zone.minOrderCents, store.minOrderCents),
      message: `Entrega para ${zone.name} em cerca de ${zone.etaMinutes} minutos.`,
    };
  }
}

/** Minusculas e sem acento, para comparar bairro digitado com o cadastrado. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}
