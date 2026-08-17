import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate limiting chaveado pelo IP REAL do cliente.
 *
 * O ThrottlerGuard padrao usa `req.ip`, que atras da nossa topologia
 * (Cloudflare -> proxy do Railway -> app) resolve para um IP de BORDA DO
 * CLOUDFLARE, nao o de quem fez a chamada. Duas consequencias, as duas
 * ruins e medidas em producao:
 *
 *  - o mesmo cliente e contado como varios: o Cloudflare distribui
 *    conexoes entre bordas diferentes, entao cada requisicao podia cair
 *    num contador novo. Na pratica, o limite por rota simplesmente nao
 *    valia — 7 chamadas seguidas passavam numa rota de limite 5/min,
 *    enquanto as mesmas 7 na MESMA conexao eram barradas na 6a.
 *  - clientes diferentes sao contados como um so: todo mundo que sai
 *    pela mesma borda divide o contador, e um abusador derrubaria
 *    terceiros junto.
 *
 * `CF-Connecting-IP` e posto pelo proprio Cloudflare e sobrescreve
 * qualquer valor que o cliente tente enviar. Como o app so e alcancavel
 * pelo dominio (que passa pelo Cloudflare), confiar nele aqui e seguro;
 * o fallback existe para desenvolvimento local, onde nao ha Cloudflare.
 */
@Injectable()
export class IpRealThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const doCloudflare = req.headers['cf-connecting-ip'];
    if (typeof doCloudflare === 'string' && doCloudflare.length > 0) {
      return doCloudflare;
    }

    /* Sem Cloudflare (desenvolvimento, chamada interna): o
       comportamento padrao ja serve. */
    return req.ip ?? 'desconhecido';
  }
}
