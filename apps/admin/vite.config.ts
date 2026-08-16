import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    /* Mesma origem que a API: e o que faz o cookie httpOnly do refresh
       token funcionar aqui como funcionara em producao. */
    proxy: {
      '/api': { target: 'http://localhost:3333', changeOrigin: true },
    },
  },
  /* sourcemap:false de proposito -- o Cloudflare Pages serve o dist/
     inteiro publicamente, .map incluido, e nao ha nenhum servico (Sentry
     ou equivalente) consumindo esses mapas hoje. Sem isso, o codigo-fonte
     legivel (comentarios, nomes de funcao, logica de negocio) fica
     acessivel a qualquer um que peca o .js.map -- confirmado, nao teorico:
     https://painel.impactdev.site/assets/*.js.map respondia 200 antes
     desta mudanca. */
  build: { outDir: 'dist', sourcemap: false },
});
