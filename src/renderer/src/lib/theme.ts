/**
 * Colour theme + accent. Stored in localStorage so the right theme paints on the very
 * first frame, and in prefs so the main process can colour the window frame to match.
 *
 * Two kinds of theme: the stylesheet ones (themes.css) and palettes derived from three
 * colours (lib/palette.ts), where the custom one is the user's own.
 */
import { create } from 'zustand'
import { derivePalette, HEX, isDarkScheme, type Anchors } from './palette'

export type ThemeName = 'dark' | 'oled' | 'graphite' | 'light'
export type PaletteName = 'azure' | 'asphalt' | 'paper' | 'pine' | 'custom'
export type AnyTheme = ThemeName | PaletteName
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

/** Whether a theme is a palette (its colours come from the anchors, not the stylesheet). */
export const usesPalette = (theme: AnyTheme): theme is PaletteName => isPalette(theme)

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

const initialTheme = stored('theme')
const initialAccent = stored('accent')
const initialCustom = (): Anchors => {
  try {
    return validAnchors(JSON.parse(stored('customPalette') ?? 'null')) ?? DEFAULT_CUSTOM
  } catch {
    return DEFAULT_CUSTOM
  }
}

export const useTheme = create<{ theme: AnyTheme; accent: AccentName; custom: Anchors; coverBg: boolean }>(() => ({
  theme: isTheme(initialTheme) || isPalette(initialTheme) ? (initialTheme as AnyTheme) : 'dark',
  // new installs start dark and fully monochrome
  accent: isAccent(initialAccent) ? initialAccent : 'mono',
  custom: initialCustom(),
  // the blurred cover of what plays, behind the panels (styles/shell.css); on unless turned off
  coverBg: stored('coverBg') !== '0'
}))

/** The colours a palette theme uses, or null for a stylesheet theme. */
export function anchorsOf(theme: AnyTheme, custom: Anchors): Anchors | null {
  if (theme === 'custom') return custom
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
    root.dataset.theme = theme
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
  const { theme, accent, custom, coverBg } = useTheme.getState()
  try {
    localStorage.setItem('theme', theme)
    localStorage.setItem('accent', accent)
    localStorage.setItem('customPalette', JSON.stringify(custom))
    localStorage.setItem('coverBg', coverBg ? '1' : '0')
  } catch {
    /* storage unavailable: prefs below still keep it */
  }
  // the window frame's colours for the next launch's first frame (the main process reads them)
  const css = getComputedStyle(document.documentElement)
  const frame = { bg: css.getPropertyValue('--bg').trim(), symbol: css.getPropertyValue('--text-2').trim() }
  void window.sc?.prefs.set({ theme, accent, customPalette: custom, coverBg, frame })
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

export function setCoverBg(coverBg: boolean): void {
  useTheme.setState({ coverBg })
  persist()
}

/** Changes one or more of the custom colours; picking any of them switches to the custom theme. */
export function setCustomColors(change: Partial<Anchors>): void {
  const next = validAnchors({ ...useTheme.getState().custom, ...change })
  if (!next) return
  useTheme.setState({ custom: next, theme: 'custom' })
  apply()
  persist()
}

/** Paint before React renders; called from main.tsx once the bridge exists. */
export function initTheme(): void {
  apply()
}
