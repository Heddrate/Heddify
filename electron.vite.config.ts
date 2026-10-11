import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { releaseNotes } from './buildNotes'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
const notes = releaseNotes(pkg.version)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          login: resolve('src/preload/login.ts'),
          yandex: resolve('src/preload/yandex.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __RELEASE_NOTES__: JSON.stringify(notes) },
    build: { minify: true }
  }
})
