/**
 * O Prettier procura a configuracao a partir do arquivo sendo formatado e
 * sobe ate a raiz. Sem este arquivo ele nao acha o pacote compartilhado e
 * cai nos padroes proprios — o que reformata o projeto inteiro com aspas
 * duplas na primeira vez que alguem rodar `npm run format`.
 */
export { default } from './packages/config/prettier.config.mjs';
