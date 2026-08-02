import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Cifragem simetrica e comparacoes seguras.
 *
 * Usado no segredo TOTP: se o banco vazar, o atacante ainda nao consegue
 * gerar os codigos de segunda etapa sem a chave, que vive so no ambiente.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    /* Deriva 32 bytes da chave configurada, aceitando qualquer comprimento. */
    this.key = createHash('sha256').update(env.ENCRYPTION_KEY).digest();
  }

  /** Cifra em AES-256-GCM. Saida: iv.authTag.ciphertext, em base64url. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  /** O GCM autentica o conteudo: adulteracao no banco faz o decrypt falhar. */
  decrypt(payload: string): string {
    const [ivPart, tagPart, dataPart] = payload.split('.');
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error('Payload cifrado em formato invalido');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Hash SHA-256 para guardar refresh token. Rapido de propósito: o token ja tem entropia alta. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
  }

  /** Token opaco de 384 bits para refresh. */
  generateToken(): string {
    return randomBytes(48).toString('base64url');
  }

  /** Comparacao em tempo constante, para nao vazar informacao pelo tempo de resposta. */
  safeEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) return false;
    return timingSafeEqual(bufferA, bufferB);
  }
}

export const AUTH_TAG_BYTES = AUTH_TAG_LENGTH;
