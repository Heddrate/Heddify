/** Injected at build time from package.json (electron.vite.config.ts / vite.web.config.ts). */
declare const __APP_VERSION__: string
/** Markdown notes of this version (release/notes), from the build. */
declare const __RELEASE_NOTES__: string
/** The website build (heddrate.com): the same interface in a browser, without Electron (src/renderer/src/web). */
declare const __WEB__: boolean
