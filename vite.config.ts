import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline'
  const demoModule = 'virtual:embedded-demo'
  return {
    base: './',
    resolve: {
      alias: {
        'ghostlens-har-worker': fileURLToPath(new URL('./src/lib/har.worker.ts', import.meta.url)) + (offline ? '?worker&inline' : '?worker'),
      },
    },
    test: { include: ['src/**/*.test.ts'] },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'embedded-demo',
        resolveId(id) { if (id === demoModule) return '\0' + id },
        load(id) {
          if (id === '\0' + demoModule) {
            const demo = offline ? readFileSync(new URL('./public/demo.har', import.meta.url), 'utf8') : null
            return 'export default ' + JSON.stringify(demo)
          }
        },
      },
      {
        name: 'local-capture-policy',
        apply: (_, env) => env.command === 'build' && !offline,
        transformIndexHtml() {
          return [{
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
            },
            injectTo: 'head-prepend',
          }]
        },
      },
      {
        name: 'distribution-license-notices',
        apply: 'build',
        generateBundle() {
          const parserDir = dirname(require.resolve('tldts/package.json'))
          const parserCoreDir = dirname(require.resolve('tldts-core/package.json', { paths: [parserDir] }))
          this.emitFile({ type: 'asset', fileName: 'LICENSE', source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8') })
          this.emitFile({
            type: 'asset',
            fileName: 'HAR-PARSER-LICENSES.txt',
            source: 'tldts\n\n' + readFileSync(join(parserDir, 'LICENSE'), 'utf8') +
              '\n\ntldts-core\n\n' + readFileSync(join(parserCoreDir, 'LICENSE'), 'utf8'),
          })
        },
      },
    ],
    build: {
      outDir: offline ? 'work/offline-build' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: offline ? 1600 : 600,
      ...(offline ? { assetsInlineLimit: () => true, cssCodeSplit: false, modulePreload: false } : {}),
      license: { fileName: 'THIRD-PARTY-LICENSES.md' },
      rollupOptions: {
        output: offline ? { inlineDynamicImports: true } : {
          manualChunks(id) {
            if (id.endsWith('/three/build/three.core.js')) return 'three-core'
            if (id.endsWith('/three/build/three.module.js')) return 'three-renderer'
          },
        },
      },
    },
  }
})
