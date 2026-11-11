import { defineConfig } from 'vite';

// base: './' sayesinde dist/ klasörü her alt yolda (GitHub Pages /depo-adi/ gibi) çalışır.
export default defineConfig({
  base: './',
  server: { port: 5199 },
  build: { chunkSizeWarningLimit: 800 }, // Three.js tek başına ~550 KB (gzip ~170 KB)
});
