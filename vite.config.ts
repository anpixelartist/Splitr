import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Keep the service worker out of `npm run dev` so code changes aren't cached
      devOptions: {
        enabled: false
      },
      // Inter is only fetched by devices without SF Pro, so it isn't precached
      // (iPhones would download it for nothing); cache it on first use instead
      workbox: {
        runtimeCaching: [{
          urlPattern: ({ request }) => request.destination === 'font',
          handler: 'CacheFirst',
          options: { cacheName: 'fonts', expiration: { maxEntries: 10 } },
        }],
      },
      manifest: {
        name: 'Splitr',
        short_name: 'Splitr',
        description: 'Local-first group expense and bill-settlement application.',
        theme_color: '#f2f2f7',
        background_color: '#f2f2f7',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  build: {
    rolldownOptions: {
      output: {
        // Firebase is most of the bundle and rarely changes. In its own chunk it
        // stays cached on phones when only the app code is updated.
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/]@?firebase/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
})
