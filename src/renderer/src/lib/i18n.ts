/**
 * Two languages. Russian strings are the keys (and the Russian text); English comes
 * from i18n.en.ts. `{0}`, `{1}` are positional placeholders. Switching language re-renders
 * the interface in place (App remounts its shell on `onLangChange`), nothing reloads.
 */
import EN from './i18n.en'

export type Lang = 'ru' | 'en'

function storedLang(): Lang {
  try {
    return localStorage.getItem('lang') === 'en' ? 'en' : 'ru'
  } catch {
    return 'ru'
  }
}

export let lang: Lang = storedLang()

const listeners = new Set<() => void>()

/** Called after the language switched; returns an unsubscribe function. */
export function onLangChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const locale = (): string => (lang === 'en' ? 'en-US' : 'ru-RU')

export function tx(s: string, ...args: unknown[]): string {
  const out = lang === 'en' ? (EN[s] ?? s) : s
  return args.length ? out.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : out
}

export function setLang(next: Lang): void {
  if (next === lang) return
  try {
    localStorage.setItem('lang', next)
  } catch {
    /* prefs below still carry it */
  }
  lang = next
  document.documentElement.lang = next
  void window.sc.prefs.set({ lang: next })
  listeners.forEach((cb) => cb())
}
