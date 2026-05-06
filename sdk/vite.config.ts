import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string }

// One entry, two formats:
//   • dist/bridle.js   (IIFE) — drops into any <script src=...> on any site
//   • dist/bridle.mjs  (ESM)  — for bundlers (Vite/webpack/Next/etc.)
//
// Both are fully self-contained: Vue runtime and socket.io-client are inlined.
// The IIFE exposes `window.Bridle = { init, BridleClient, ... }` and also
// auto-mounts whenever the loading <script> tag carries a data-bot-id.
export default defineConfig({
  plugins: [
    vue({
      // .ce.vue files compile as Custom Elements with shadow-DOM scoped styles.
      // Nothing leaks into the host page.
      customElement: /\.ce\.vue$/,
    }),
  ],
  define: {
    __BRIDLE_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2019',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Bridle',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'iife' ? 'bridle.js' : 'bridle.mjs'),
    },
    rollupOptions: {
      // Inline everything. Embedders just include one file.
      external: [],
      output: {
        // IIFE attaches to window.Bridle = { init, BridleClient, tag, version }.
        // Named-only — no default export to keep the public surface obvious.
        exports: 'named',
        extend: true,
        globals: {},
      },
    },
  },
})
