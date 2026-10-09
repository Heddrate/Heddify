/**
 * Colour theme + accent. Stored in localStorage so the right theme paints on the very
 * first frame, and in prefs so the main process can colour the window frame to match.
 */
import { create } from 'zustand'

export type ThemeName = 'dark' | 'oled' | 'graphite' | 'light'
export type AccentName = 'orange' | 'mono'

/** Labels are Russian keys, translated where shown (the language can change at runtime). */
export const THEMES: { id: ThemeName; label: string; preview: [bg: string, panel: string, raised: string, text: string] }[] = [
  { id: 'dark', label: "Тёмная", preview: ['#0b0b0b', '#131313', '#262626', '#f2f2f2'] },
  { id: 'oled', label: "Чёрная", preview: ['#000000', '#0a0a0a', '#1c1c1c', '#f2f2f2'] },
  { id: 'graphite', label: "Графит", preview: ['#1c1c1c', '#242424', '#353535', '#f0f0f0'] },
  { id: 'light', label: "Светлая", preview: ['#e9e9e9', '#ffffff', '#e8e8e8', '#121212'] }
]

export const ACCENTS: { id: AccentName; label: string }[] = [
  { id: 'orange', label: "Оранжевый SoundCloud" },
  { id: 'mono', label: "Монохром" }
]

const isTheme = (v: unknown): v is ThemeName => THEMES.some((t) => t.id === v)
const isAccent = (v: unknown): v is AccentName => ACCENTS.some((a) => a.id === v)

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const initialTheme = stored('theme')
const initialAccent = stored('accent')

export const useTheme = create<{ theme: ThemeName; accent: AccentName }>(() => ({
  theme: isTheme(initialTheme) ? initialTheme : 'dark',
  // new installs start dark and fully monochrome
  accent: isAccent(initialAccent) ? initialAccent : 'mono'
}))

function apply(): void {
  const { theme, accent } = useTheme.getState()
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.accent = accent
  // native window frame (title bar buttons) follows the theme
  const css = getComputedStyle(root)
  window.sc?.setWindowTheme({ bg: css.getPropertyValue('--bg').trim(), symbol: css.getPropertyValue('--text-2').trim() })
}

function persist(): void {
  const { theme, accent } = useTheme.getState()
  try {
    localStorage.setItem('theme', theme)
    localStorage.setItem('accent', accent)
  } catch {
    /* storage unavailable: prefs below still keep it */
  }
  void window.sc?.prefs.set({ theme, accent })
}

export function setTheme(theme: ThemeName): void {
  useTheme.setState({ theme })
  apply()
  persist()
}

export function setAccent(accent: AccentName): void {
  useTheme.setState({ accent })
  apply()
  persist()
}

/** Paint before React renders; called from main.tsx once the bridge exists. */
export function initTheme(): void {
  apply()
}
