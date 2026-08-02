import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';
import { toDataURL } from 'qrcode';

const ISSUER = 'Adventure Burguer';

/**
 * Segunda etapa por TOTP (RFC 6238), compativel com Google Authenticator,
 * Authy, 1Password e similares.
 *
 * A tolerancia e assimetrica — [30, 0] — aceitando a janela ANTERIOR mas
 * nao a futura. Isso cobre relogio atrasado e o tempo de digitacao, sem
 * ampliar a janela de um codigo interceptado.
 */
const EPOCH_TOLERANCE: [number, number] = [30, 0];

@Injectable()
export class TotpService {
  /** Segredo de 20 bytes (160 bits), conforme recomenda a RFC 4226. */
  generateSecret(): string {
    return generateSecret({ length: 20 });
  }

  /** URI otpauth:// que o app autenticador le. */
  buildOtpAuthUrl(secret: string, accountEmail: string): string {
    return generateURI({
      strategy: 'totp',
      issuer: ISSUER,
      label: accountEmail,
      secret,
    });
  }

  async buildQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
    return toDataURL(otpAuthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  }

  async verify(code: string, secret: string): Promise<boolean> {
    try {
      const result = await verify({
        secret,
        token: code,
        strategy: 'totp',
        epochTolerance: EPOCH_TOLERANCE,
      });
      return result.valid;
    } catch {
      /* Segredo malformado nao deve derrubar a requisicao. */
      return false;
    }
  }
}
