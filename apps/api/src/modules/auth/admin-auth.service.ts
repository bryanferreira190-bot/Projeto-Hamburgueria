import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  requiresTotp,
  type AdminLoginInput,
  type AdminRole,
  type ChangePasswordInput,
} from '@adventure/shared';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PasswordService } from '../../common/crypto/password.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TokenService, type IssuedTokens } from './token.service';
import { TotpService } from './totp.service';

export interface AdminSummary {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

/**
 * Uniao discriminada em vez de campos opcionais: o TypeScript passa a
 * garantir que TOTP_REQUIRED nunca carregue tokens, e que AUTHENTICATED
 * sempre os tenha.
 */
export type LoginResult =
  | { status: 'TOTP_REQUIRED'; challengeToken: string }
  | { status: 'TOTP_SETUP_REQUIRED'; setupToken: string }
  | { status: 'AUTHENTICATED'; tokens: IssuedTokens; admin: AdminSummary };

interface DeviceInfo {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Primeira etapa do login.
   *
   * Toda falha devolve exatamente a mesma mensagem e gasta o mesmo tempo,
   * mesmo quando o e-mail nao existe. Diferenciar "e-mail nao encontrado" de
   * "senha incorreta" entrega ao atacante a lista de contas validas.
   */
  async login(input: AdminLoginInput, device: DeviceInfo): Promise<LoginResult> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { email: input.email },
    });

    if (!admin) {
      await this.passwords.fakeVerify();
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const minutes = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `Conta bloqueada por tentativas incorretas. Tente novamente em ${minutes} min.`,
      );
    }

    const passwordOk = await this.passwords.verify(admin.passwordHash, input.password);

    if (!passwordOk) {
      await this.registerFailedAttempt(admin.id, admin.failedLoginCount);
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }

    if (!admin.isActive) {
      throw new ForbiddenException('Usuario desativado');
    }

    await this.resetFailedAttempts(admin.id);

    const role = admin.role as AdminRole;

    /**
     * Papeis que mexem em dinheiro e configuracao exigem segunda etapa.
     * Quem ainda nao configurou recebe um token de escopo restrito, que
     * abre apenas as rotas de configuracao do 2FA — nunca o painel.
     */
    if (this.env.REQUIRE_ADMIN_2FA && requiresTotp(role) && !admin.totpEnabledAt) {
      return {
        status: 'TOTP_SETUP_REQUIRED',
        setupToken: this.tokens.createTotpSetupToken({
          id: admin.id,
          email: admin.email,
          role,
          storeId: admin.storeId,
        }),
      };
    }

    /* REQUIRE_ADMIN_2FA=false tambem pula esta etapa para quem ja tem 2FA
       cadastrado — nao so bloqueia o cadastro de quem ainda nao tem (ver
       acima). O totpSecret continua gravado; e so a cobranca no login
       que para, e volta assim que a flag voltar para true. */
    if (this.env.REQUIRE_ADMIN_2FA && admin.totpEnabledAt) {
      return {
        status: 'TOTP_REQUIRED',
        challengeToken: this.tokens.createTotpChallenge(admin.id),
      };
    }

    return {
      status: 'AUTHENTICATED',
      tokens: await this.tokens.issueTokens(
        { id: admin.id, email: admin.email, role, storeId: admin.storeId },
        device,
      ),
      admin: { id: admin.id, name: admin.name, email: admin.email, role },
    };
  }

  /** Segunda etapa: valida o codigo do app autenticador. */
  async loginWithTotp(
    challengeToken: string,
    code: string,
    device: DeviceInfo,
  ): Promise<LoginResult> {
    const adminId = this.tokens.verifyTotpChallenge(challengeToken);

    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin?.totpSecret || !admin.isActive) {
      throw new UnauthorizedException('Sessao invalida');
    }

    const secret = this.crypto.decrypt(admin.totpSecret);

    if (!(await this.totp.verify(code, secret))) {
      await this.registerFailedAttempt(admin.id, admin.failedLoginCount);
      throw new UnauthorizedException('Codigo de verificacao incorreto');
    }

    await this.resetFailedAttempts(admin.id);
    const role = admin.role as AdminRole;

    return {
      status: 'AUTHENTICATED',
      tokens: await this.tokens.issueTokens(
        { id: admin.id, email: admin.email, role, storeId: admin.storeId },
        device,
      ),
      admin: { id: admin.id, name: admin.name, email: admin.email, role },
    };
  }

  /** Gera o segredo e o QR Code. So passa a valer apos confirmacao com um codigo. */
  async startTotpSetup(
    adminId: string,
  ): Promise<{ secret: string; otpAuthUrl: string; qrCode: string }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();

    if (admin.totpEnabledAt) {
      throw new BadRequestException('A autenticacao em duas etapas ja esta ativa');
    }

    const secret = this.totp.generateSecret();
    const otpAuthUrl = this.totp.buildOtpAuthUrl(secret, admin.email);

    /* Guardado cifrado e ainda nao habilitado: se o usuario abandonar o
       processo, a conta continua funcionando com senha apenas. */
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { totpSecret: this.crypto.encrypt(secret), totpEnabledAt: null },
    });

    return { secret, otpAuthUrl, qrCode: await this.totp.buildQrCodeDataUrl(otpAuthUrl) };
  }

  async confirmTotpSetup(adminId: string, code: string): Promise<{ enabled: true }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin?.totpSecret) {
      throw new BadRequestException('Inicie a configuracao antes de confirmar');
    }

    const secret = this.crypto.decrypt(admin.totpSecret);
    if (!(await this.totp.verify(code, secret))) {
      throw new BadRequestException('Codigo incorreto. Confira o app autenticador.');
    }

    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { totpEnabledAt: new Date() },
    });

    /* Id, nao e-mail: log nao e lugar para dado pessoal que nao precisa
       estar ali — o id ja identifica a conta de sobra para auditoria. */
    this.logger.log(`2FA ativado para admin ${adminId}`);
    return { enabled: true };
  }

  async changePassword(adminId: string, input: ChangePasswordInput): Promise<{ changed: true }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();

    if (!(await this.passwords.verify(admin.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });

    /* Trocar a senha derruba as demais sessoes: se alguem tinha acesso
       indevido, o token dele para de funcionar imediatamente. */
    await this.tokens.revokeAllForAdmin(adminId);

    return { changed: true };
  }

  async getProfile(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        totpEnabledAt: true,
        lastLoginAt: true,
      },
    });

    if (!admin) throw new UnauthorizedException();

    return { ...admin, totpEnabled: admin.totpEnabledAt !== null };
  }

  private async registerFailedAttempt(adminId: string, currentCount: number): Promise<void> {
    const attempts = currentCount + 1;
    const shouldLock = attempts >= this.env.LOGIN_MAX_ATTEMPTS;

    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: {
        failedLoginCount: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000)
          : null,
      },
    });

    if (shouldLock) {
      this.logger.warn(`Conta ${adminId} bloqueada apos ${attempts} tentativas`);
    }
  }

  private async resetFailedAttempts(adminId: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }
}
