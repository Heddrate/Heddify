// The renderer in a plain browser.
//   `npm run dev:web`           — with mock data (see src/renderer/src/dev/mock.ts), for working on the UI;
//   `npm run build:web` (--mode web) — the website heddrate.com: the real services that work in a browser
//                                  (src/renderer/src/web/bridge.ts), into out/web.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { releaseNotes } from './buildNotes'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as { version: string }

/** The website's extras: its version (open tabs check it to offer the new one), the icon, its title. */
function site(): Plugin {
  return {
    name: 'heddify-site',
    transformIndexHtml: (html) =>
      html
        .replace('<title>Heddify</title>', '<title>Heddify — музыка</title>')
        .replace(
          '</head>',
          '    <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
            '    <meta name="description" content="Heddify: Audius, радио и свои файлы в одном плеере. Приложение для Windows — ещё SoundCloud, Яндекс Музыка и ВКонтакте." />\n' +
            '    <meta name="theme-color" content="#0b0b0b" />\n' +
            '    <link rel="icon" type="image/png" href="/icon.png" />\n' +
            '  </head>'
        ),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version }) })
      this.emitFile({ type: 'asset', fileName: 'icon.png', source: readFileSync(resolve(here, 'build/icon.png')) })
    }
  }
}

export default defineConfig(({ mode }) => {
  const web = mode === 'web'
  return {
    root: resolve(here, 'src/renderer'),
    resolve: { alias: { '@': resolve(here, 'src/renderer/src') } },
    plugins: [react(), ...(web ? [site()] : [])],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __RELEASE_NOTES__: JSON.stringify(releaseNotes(pkg.version)),
      __WEB__: JSON.stringify(web)
    },
    base: '/',
    build: { outDir: resolve(here, 'out/web'), emptyOutDir: true, minify: true },
    server: { port: 5173, strictPort: true }
  }
})
