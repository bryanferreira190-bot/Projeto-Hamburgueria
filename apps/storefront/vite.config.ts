import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import sirv from 'sirv';

const landingDir = fileURLToPath(new URL('../landing', import.meta.url));

/** Expoe apps/landing em /landing, para reaproveitar as fotos dos produtos. */
function servirImagensDaLanding(): Plugin {
  return {
    name: 'servir-imagens-da-landing',
    configureServer(server) {
      const serve = sirv(landingDir, { dev: true, etag: true });
      server.middlewares.use('/landing', serve);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), servirImagensDaLanding()],
  server: {
    port: 5173,
    /**
     * As fotos dos produtos moram em apps/landing/assets/img. Servimos essa
     * pasta em /landing para nao duplicar ~2 MB de imagens no repositorio.
     * Em producao, o mesmo caminho e servido pelo CDN.
     */
    fs: { allow: ['..', '../..'] },
    /**
     * O proxy evita CORS em desenvolvimento e, principalmente, faz o
     * navegador enxergar API e front na MESMA origem — o que e necessario
     * para cookies SameSite=strict funcionarem como funcionarao em producao.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
      },
    },
  },
  /* sourcemap:false de proposito -- o Cloudflare Pages serve o dist/
     inteiro publicamente, .map incluido, e nao ha nenhum servico (Sentry
     ou equivalente) consumindo esses mapas hoje. Sem isso, o codigo-fonte
     legivel (comentarios, nomes de funcao, logica de negocio) fica
     acessivel a qualquer um que peca o .js.map -- confirmado, nao teorico:
     https://loja.impactdev.site/assets/*.js.map respondia 200 antes
     desta mudanca. */
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
