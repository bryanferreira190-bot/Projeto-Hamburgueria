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
  build: { outDir: 'dist', sourcemap: true },
});
