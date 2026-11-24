/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base: './' lets the built app run from any folder or GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Coho Trucking PoC', short_name: 'Coho Trucking',
        description: 'Proof of concept: dockets, km and timesheets for Coho trucking',
        theme_color: '#1f3864', background_color: '#ffffff', display: 'standalone',
        start_url: './', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { navigateFallback: 'index.html', maximumFileSizeToCacheInBytes: 5_000_000 },
    }),
  ],
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
