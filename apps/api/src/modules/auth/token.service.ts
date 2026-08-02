import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole } from '@adventure/shared';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: AdminRole;
  storeId: string;
  type: 'access';
}

export interface TotpChallengePayload {
  sub: string;
  type: 'totp_challenge';
}

/** Escopo minimo: so permite configurar o 2FA, nada mais. */
export interface TotpSetupPayload {
  sub: string;
  email: string;
  role: AdminRole;
  storeId: string;
  type: 'totp_setup';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface DeviceInfo {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Emite o par de tokens iniciando uma nova familia.
   * Cada login e uma familia distinta, entao revogar uma sessao comprometida
   * nao derruba os outros dispositivos do mesmo usuario.
   */
  async issueTokens(
    admin: { id: string; email: string; role: AdminRole; storeId: string },
    device: DeviceInfo,
  ): Promise<IssuedTokens> {
    const familyId = randomUUID();
    return this.issueForFamily(admin, familyId, device);
  }

  /**
   * ROTACAO COM DETECCAO DE REUSO
   *
   * Cada refresh queima o token usado e emite outro. Se um token ja consumido
   * reaparece, so ha duas explicacoes: copia roubada ou replay. Nos dois casos
   * a resposta e a mesma — revogar a familia inteira e forcar novo login.
   */
  async rotateRefreshToken(rawToken: string, device: DeviceInfo): Promise<IssuedTokens> {
    const tokenHash = this.crypto.hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { adminUser: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Sessao invalida');
    }

    if (stored.revokedAt) {
      /* Token ja usado reaparecendo: trata-se como comprometimento. */
      this.logger.warn(
        `Reuso de refresh token detectado (familia ${stored.familyId}). Revogando a familia.`,
      );
      await this.revokeFamily(stored.familyId, 'reuso detectado');
      throw new UnauthorizedException('Sessao encerrada por seguranca. Entre novamente.');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessao expirada');
    }

    if (!stored.adminUser.isActive) {
      await this.revokeFamily(stored.familyId, 'usuario inativo');
      throw new UnauthorizedException('Usuario inativo');
    }

    const next = await this.issueForFamily(
      {
        id: stored.adminUser.id,
        email: stored.adminUser.email,
        role: stored.adminUser.role as AdminRole,
        storeId: stored.adminUser.storeId,
      },
      stored.familyId,
      device,
    );

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return next;
  }

  async revokeToken(rawToken: string): Promise<void> {
    const tokenHash = this.crypto.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string, _reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Encerra todas as sessoes do usuario — usado ao trocar a senha. */
  async revokeAllForAdmin(adminUserId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { adminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      if (payload.type !== 'access') {
        throw new UnauthorizedException('Token de tipo incorreto');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Token invalido ou expirado');
    }
  }

  /**
   * Token de escopo restrito para quem ainda precisa configurar o 2FA
   * obrigatorio. Vale 15 minutos e nao abre nenhuma rota de negocio.
   */
  createTotpSetupToken(admin: {
    id: string;
    email: string;
    role: AdminRole;
    storeId: string;
  }): string {
    return this.jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        storeId: admin.storeId,
        type: 'totp_setup',
      } satisfies TotpSetupPayload,
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
    );
  }

  verifyTotpSetupToken(token: string): TotpSetupPayload {
    try {
      const payload = this.jwt.verify<TotpSetupPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      if (payload.type !== 'totp_setup') {
        throw new UnauthorizedException('Token de tipo incorreto');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Token de configuracao invalido ou expirado');
    }
  }

  /** Token curto que autoriza apenas a segunda etapa do login. */
  createTotpChallenge(adminId: string): string {
    return this.jwt.sign({ sub: adminId, type: 'totp_challenge' } satisfies TotpChallengePayload, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: '5m',
    });
  }

  verifyTotpChallenge(token: string): string {
    try {
      const payload = this.jwt.verify<TotpChallengePayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      if (payload.type !== 'totp_challenge') {
        throw new UnauthorizedException('Token de tipo incorreto');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Desafio de segunda etapa invalido ou expirado');
    }
  }

  private async issueForFamily(
    admin: { id: string; email: string; role: AdminRole; storeId: string },
    familyId: string,
    device: DeviceInfo,
  ): Promise<IssuedTokens> {
    const accessToken = this.jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        storeId: admin.storeId,
        type: 'access',
      } satisfies AccessTokenPayload,
      /* O tipo de expiresIn no @nestjs/jwt vem do pacote ms, que so aceita
         literais como "15m". Nosso valor e validado em runtime pelo Zod. */
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL as `${number}m` },
    );

    /* Refresh e token opaco, nao JWT: precisa ser revogavel no banco. */
    const refreshToken = this.crypto.generateToken();

    await this.prisma.refreshToken.create({
      data: {
        adminUserId: admin.id,
        tokenHash: this.crypto.hashToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + parseDuration(this.env.JWT_REFRESH_TTL)),
        userAgent: device.userAgent?.slice(0, 300) ?? null,
        ipAddress: device.ipAddress?.slice(0, 45) ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDuration(this.env.JWT_ACCESS_TTL) / 1000),
    };
  }
}

/** Converte "15m", "7d", "30s" em milissegundos. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Duracao invalida: "${value}". Use formatos como 15m, 24h ou 7d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

  return amount * multipliers[unit];
}
