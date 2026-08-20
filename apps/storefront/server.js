import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';

/**
 * SERVIDOR DE PRODUCAO DO STOREFRONT (Railway)
 *
 * O storefront e uma SPA estatica (vite build -> dist/); em producao no
 * Cloudflare Pages nada disto e necessario, o proprio Cloudflare serve o
 * dist/. Este arquivo so existe para quando o storefront roda como
 * servico Railway (ver railway.storefront.json) — Railway espera um
 * processo escutando numa porta, nao um monte de arquivos estaticos.
 *
 * `single: true` faz qualquer rota que nao bata com um arquivo real
 * (ex.: /checkout, /pedido/A001) cair de volta em index.html — sem isso,
 * abrir uma dessas rotas direto (F5, link compartilhado) devolveria 404,
 * porque so o react-router sabe dessas rotas, e ele so roda depois que
 * index.html carrega.
 */
const dist = fileURLToPath(new URL('./dist', import.meta.url));
const serve = sirv(dist, { single: true, etag: true, gzip: true, brotli: true });

const port = process.env.PORT ?? 4173;

createServer((req, res) => {
  serve(req, res, () => {
    res.statusCode = 404;
    res.end('Not found');
  });
}).listen(port, () => {
  console.log(`storefront ouvindo na porta ${port}`);
});
