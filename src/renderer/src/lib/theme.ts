/**
 * Colour theme + accent + what is behind the interface. Stored in localStorage so the right
 * theme paints on the very first frame, and in prefs so the main process can colour the window
 * frame to match.
 *
 * Three kinds of theme: the stylesheet ones (themes.css), palettes derived from three colours
 * (lib/palette.ts), where "custom" is the user's own, and the user's saved themes ("user:<id>",
 * colours plus a background; lib/userThemes.ts).
 */
import { create } from 'zustand'
import { derivePalette, HEX, isDarkScheme, type Anchors } from './palette'
import { cleanColors, cleanLook, cleanName, DEFAULT_LOOK, isBgMode, type BgLook, type BgMode, type UserTheme } from './themeFile'

export type ThemeName = 'dark' | 'oled' | 'graphite' | 'light'
export type PaletteName = 'azure' | 'asphalt' | 'paper' | 'pine' | 'custom'
export type UserThemeId = `user:${string}`
export type AnyTheme = ThemeName | PaletteName | UserThemeId
export type AccentName = 'orange' | 'mono'

/** Labels are Russian keys, translated where shown (the language can change at runtime). */
export const THEMES: { id: ThemeName; label: string; preview: [bg: string, panel: string, raised: string, text: string] }[] = [
  { id: 'dark', label: "Тёмная", preview: ['#0b0b0b', '#131313', '#262626', '#f2f2f2'] },
  { id: 'oled', label: "Чёрная", preview: ['#000000', '#0a0a0a', '#1c1c1c', '#f2f2f2'] },
  { id: 'graphite', label: "Графит", preview: ['#1c1c1c', '#242424', '#353535', '#f0f0f0'] },
  { id: 'light', label: "Светлая", preview: ['#e9e9e9', '#ffffff', '#e8e8e8', '#121212'] }
]

/** Palettes from three colours: the reference set. The colours are the anchors. */
export const PALETTES: { id: Exclude<PaletteName, 'custom'>; label: string; colors: Anchors }[] = [
  { id: 'azure', label: "Азур", colors: { bg: '#000f0f', text: '#e8f5fb', accent: '#68c7ec' } },
  { id: 'asphalt', label: "Асфальт", colors: { bg: '#302f2c', text: '#efede3', accent: '#efede3' } },
  { id: 'paper', label: "Бумага", colors: { bg: '#efede3', text: '#302f2c', accent: '#302f2c' } },
  { id: 'pine', label: "Хвоя", colors: { bg: '#00311f', text: '#fffdf2', accent: '#fffdf2' } }
]

export const DEFAULT_CUSTOM: Anchors = { bg: '#0b0b0b', text: '#f2f2f2', accent: '#f2f2f2' }

export const ACCENTS: { id: AccentName; label: string }[] = [
  { id: 'orange', label: "Оранжевый SoundCloud" },
  { id: 'mono', label: "Монохром" }
]

const isTheme = (v: unknown): v is ThemeName => THEMES.some((t) => t.id === v)
const isPalette = (v: unknown): v is PaletteName => v === 'custom' || PALETTES.some((p) => p.id === v)
const isAccent = (v: unknown): v is AccentName => ACCENTS.some((a) => a.id === v)
export const isUserTheme = (v: unknown): v is UserThemeId => typeof v === 'string' && v.startsWith('user:')

/** Whether a theme is a palette (its colours come from the anchors, not the stylesheet). */
export const usesPalette = (theme: AnyTheme): theme is PaletteName | UserThemeId => isPalette(theme) || isUserTheme(theme)

/** Anchors are three valid colours; anything else is dropped. */
export function validAnchors(v: unknown): Anchors | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const ok = (k: keyof Anchors): boolean => typeof a[k] === 'string' && HEX.test(a[k] as string)
  return ok('bg') && ok('text') && ok('accent') ? { bg: a.bg as string, text: a.text as string, accent: a.accent as string } : null
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storedJson(key: string): unknown {
  try {
    return JSON.parse(stored(key) ?? 'null')
  } catch {
    return null
  }
}

const initialTheme = stored('theme')
const initialAccent = stored('accent')

function initialUserThemes(): UserTheme[] {
  const list = storedJson('userThemes')
  if (!Array.isArray(list)) return []
  const out: UserTheme[] = []
  for (const t of list as Record<string, unknown>[]) {
    const colors = cleanColors(t?.colors)
    if (!colors || typeof t.id !== 'string') continue
    out.push({ id: t.id, name: cleanName(t.name, 'Тема'), colors, bg: isBgMode(t.bg) ? t.bg : 'plain', look: cleanLook(t.look), image: t.image === true })
  }
  return out
}

const userThemes = initialUserThemes()
// before 1.8.23 the background was a switch: the blurred cover, on unless turned off
const initialBg = stored('bgMode')

export const useTheme = create<{ theme: AnyTheme; accent: AccentName; custom: Anchors; bg: BgMode; look: BgLook; userThemes: UserTheme[] }>(() => ({
  theme:
    isTheme(initialTheme) || isPalette(initialTheme) || (isUserTheme(initialTheme) && userThemes.some((t) => `user:${t.id}` === initialTheme))
      ? (initialTheme as AnyTheme)
      : 'dark',
  // new installs start dark and fully monochrome
  accent: isAccent(initialAccent) ? initialAccent : 'mono',
  custom: validAnchors(storedJson('customPalette')) ?? DEFAULT_CUSTOM,
  bg: isBgMode(initialBg) ? initialBg : stored('coverBg') === '0' ? 'plain' : 'cover',
  look: storedJson('bgLook') ? cleanLook(storedJson('bgLook')) : DEFAULT_LOOK,
  userThemes
}))

/** The colours a palette theme uses, or null for a stylesheet theme. */
export function anchorsOf(theme: AnyTheme, custom: Anchors, saved: UserTheme[] = useTheme.getState().userThemes): Anchors | null {
  if (theme === 'custom') return custom
  if (isUserTheme(theme)) return saved.find((t) => `user:${t.id}` === theme)?.colors ?? null
  return PALETTES.find((p) => p.id === theme)?.colors ?? null
}

/** Every variable a palette sets; cleared again when a stylesheet theme comes back. */
const PALETTE_VARS = Object.keys(derivePalette(DEFAULT_CUSTOM))

function apply(): void {
  const { theme, accent, custom } = useTheme.getState()
  const root = document.documentElement
  const colors = anchorsOf(theme, custom)
  if (colors) {
    root.dataset.theme = 'palette'
    for (const [k, v] of Object.entries(derivePalette(colors))) root.style.setProperty(`--${k}`, v)
    root.style.colorScheme = isDarkScheme(colors) ? 'dark' : 'light'
  } else {
    root.dataset.theme = isUserTheme(theme) ? 'dark' : theme
    for (const k of PALETTE_VARS) root.style.removeProperty(`--${k}`)
    root.style.colorScheme = ''
  }
  root.dataset.accent = accent
  syncWindowFrame()
}

/** The native title bar buttons take the theme's colours (a view can paint its own and call this to restore). */
export function syncWindowFrame(): void {
  const css = getComputedStyle(document.documentElement)
  window.sc?.setWindowTheme({ bg: css.getPropertyValue('--bg').trim(), symbol: css.getPropertyValue('--text-2').trim() })
}

function persist(): void {
  const { theme, accent, custom, bg, look, userThemes } = useTheme.getState()
  try {
    localStorage.setItem('theme', theme)
    localStorage.setItem('accent', accent)
    localStorage.setItem('customPalette', JSON.stringify(custom))
    localStorage.setItem('bgMode', bg)
    localStorage.setItem('bgLook', JSON.stringify(look))
    localStorage.setItem('userThemes', JSON.stringify(userThemes))
  } catch {
    /* storage unavailable: prefs below still keep it */
  }
  // the window frame's colours for the next launch's first frame (the main process reads them)
  const css = getComputedStyle(document.documentElement)
  const frame = { bg: css.getPropertyValue('--bg').trim(), symbol: css.getPropertyValue('--text-2').trim() }
  void window.sc?.prefs.set({ theme, accent, customPalette: custom, frame })
}

export function setTheme(theme: AnyTheme): void {
  useTheme.setState({ theme })
  apply()
  persist()
}

export function setAccent(accent: AccentName): void {
  useTheme.setState({ accent })
  apply()
  persist()
}

/** What is behind the interface: nothing, the playing cover, or the user's picture. */
export function setBg(bg: BgMode): void {
  useTheme.setState({ bg })
  persist()
}

/** Changes how the picture looks; `save` once the user lets go of the slider. */
export function setLook(change: Partial<BgLook>, save = true): void {
  useTheme.setState({ look: cleanLook({ ...useTheme.getState().look, ...change }) })
  if (save) persist()
}

/** Applies several settings at once (a user theme): colours, background, look. */
export function applyLook(state: Partial<{ theme: AnyTheme; bg: BgMode; look: BgLook; userThemes: UserTheme[] }>): void {
  useTheme.setState(state)
  apply()
  persist()
}

/** Changes one or more of the custom colours; picking any of them switches to the custom theme. */
export function setCustomColors(change: Partial<Anchors>): void {
  // a saved theme being changed starts from its own colours
  const base = anchorsOf(useTheme.getState().theme, useTheme.getState().custom) ?? useTheme.getState().custom
  const next = validAnchors({ ...base, ...change })
  if (!next) return
  useTheme.setState({ custom: next, theme: 'custom' })
  apply()
  persist()
}

/** The three colours of whatever theme is on now (a stylesheet theme read from its variables). */
export function currentAnchors(): Anchors {
  const { theme, custom } = useTheme.getState()
  const own = anchorsOf(theme, custom)
  if (own) return own
  const css = getComputedStyle(document.documentElement)
  const read = (v: string, fallback: string): string => {
    const value = css.getPropertyValue(v).trim()
    return HEX.test(value) ? value : fallback
  }
  return { bg: read('--bg', DEFAULT_CUSTOM.bg), text: read('--text', DEFAULT_CUSTOM.text), accent: read('--accent', DEFAULT_CUSTOM.accent) }
}

/** Paint before React renders; called from main.tsx once the bridge exists. */
export function initTheme(): void {
  apply()
}
