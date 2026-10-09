// Renderer in a plain browser with mock data (see src/renderer/src/dev/mock.ts).
// Handy for working on the UI without signing in: `npm run dev:web`.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  root: resolve(here, 'src/renderer'),
  resolve: { alias: { '@': resolve(here, 'src/renderer/src') } },
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: true }
})
