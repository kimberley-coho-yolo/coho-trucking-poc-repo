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
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'brand/*.png'],
      manifest: {
        name: 'Coho Drive', short_name: 'Coho Drive',
        description: 'Coho Drive: dockets, km and timesheets for Coho drivers (proof of concept)',
        theme_color: '#141319', background_color: '#ffffff', display: 'standalone',
        start_url: './', icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: 'index.html', maximumFileSizeToCacheInBytes: 5_000_000 },
    }),
  ],
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
