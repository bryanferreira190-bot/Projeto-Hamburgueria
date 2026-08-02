import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Hash de senha com Argon2id.
 *
 * Argon2id venceu a Password Hashing Competition e e a recomendacao atual da
 * OWASP, acima de bcrypt: resiste tanto a ataque por GPU quanto por
 * canal lateral.
 *
 * Parametros seguem o perfil recomendado pela OWASP (19 MiB, 2 iteracoes,
 * paralelismo 1).
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash descartavel, usado quando o e-mail nao existe. Serve para gastar o
 * mesmo tempo de um login real e nao revelar quais e-mails estao cadastrados.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Yx7WQlBLnDkNiTHVLPRMBqPqDqXPRLwEqvXBCLBLxvI';

@Injectable()
export class PasswordService {
  async hash(plainPassword: string): Promise<string> {
    return hash(plainPassword, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plainPassword);
    } catch {
      /* Hash corrompido ou em formato desconhecido nao deve derrubar o login. */
      return false;
    }
  }

  /**
   * Gasta tempo equivalente a uma verificacao real.
   *
   * Sem isto, responder rapido para e-mail inexistente e devagar para e-mail
   * existente entrega ao atacante a lista de contas validas.
   */
  async fakeVerify(): Promise<void> {
    await this.verify(DUMMY_HASH, 'senha-que-nunca-confere');
  }
}
