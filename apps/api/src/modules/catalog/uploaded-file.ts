/**
 * Formato do arquivo entregue pelo multer.
 *
 * Declarado aqui em vez de usar o global `Express.Multer.File`: o tsconfig
 * restringe quais @types entram (`types: ["node"]`), entao aquele namespace
 * nao existe na compilacao. Declarar so o que usamos tambem deixa explicito
 * o contrato — e nao amarra o codigo ao multer, caso ele saia um dia.
 *
 * O nome NAO e "UploadedFile" de proposito: o NestJS ja exporta um
 * decorator com esse nome, e os dois no mesmo arquivo colidem.
 */
export interface ArquivoEnviado {
  /** Nome original no computador de quem enviou. */
  originalname: string;
  /** Tipo declarado pelo navegador. Nao e confiavel sozinho — validamos o tamanho tambem. */
  mimetype: string;
  size: number;
  buffer: Buffer;
}
