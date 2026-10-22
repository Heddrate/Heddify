/**
 * The user's own themes and the file they travel in (".heddify-theme"): three colours, the
 * background (none, the playing cover, or a picture with its blur, dimming…) and the picture
 * itself. Pure: no storage, no page (tests/themeFile.test.ts); lib/theme.ts keeps the themes.
 */
import { HEX, type Anchors } from './palette'

export type BgMode = 'plain' | 'cover' | 'image'

/** How a picture behind the interface looks. */
export interface BgLook {
  /** Blur, px. */
  blur: number
  /** A veil of the theme's background over the picture, 0..1. */
  dim: number
  /** Colour strength of the picture, 1 = as it is. */
  saturate: number
  /** How much of the picture shows through the panels, 0 = solid panels. */
  clear: number
}

export const DEFAULT_LOOK: BgLook = { blur: 18, dim: 0.35, saturate: 1, clear: 0.35 }

/** The limits of every setting; the sliders use the same. */
export const LOOK_LIMITS: Record<keyof BgLook, { min: number; max: number }> = {
  blur: { min: 0, max: 60 },
  dim: { min: 0, max: 0.9 },
  saturate: { min: 0, max: 2 },
  clear: { min: 0, max: 0.8 }
}

export interface UserTheme {
  id: string
  name: string
  colors: Anchors
  bg: BgMode
  look: BgLook
  /** Whether a picture belongs to it (kept apart, see lib/wallpaper.ts). */
  image: boolean
}

export const THEME_FORMAT = 'heddify-theme'
export const THEME_EXT = '.heddify-theme'
const NAME_MAX = 40
/** A picture inside a theme file stays below this (the file is text, base64). */
export const IMAGE_MAX_CHARS = 24_000_000
const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/

const clamp = (v: unknown, { min, max }: { min: number; max: number }, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}

/** Every setting within its limits; anything missing takes the default. */
export function cleanLook(v: unknown): BgLook {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    blur: clamp(o.blur, LOOK_LIMITS.blur, DEFAULT_LOOK.blur),
    dim: clamp(o.dim, LOOK_LIMITS.dim, DEFAULT_LOOK.dim),
    saturate: clamp(o.saturate, LOOK_LIMITS.saturate, DEFAULT_LOOK.saturate),
    clear: clamp(o.clear, LOOK_LIMITS.clear, DEFAULT_LOOK.clear)
  }
}

export const isBgMode = (v: unknown): v is BgMode => v === 'plain' || v === 'cover' || v === 'image'

/** Three valid colours, or null. */
export function cleanColors(v: unknown): Anchors | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const ok = (k: keyof Anchors): boolean => typeof a[k] === 'string' && HEX.test(a[k] as string)
  return ok('bg') && ok('text') && ok('accent') ? { bg: (a.bg as string).toLowerCase(), text: (a.text as string).toLowerCase(), accent: (a.accent as string).toLowerCase() } : null
}

export function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return (s || fallback).slice(0, NAME_MAX)
}

/** A theme as it is written to a file: the picture goes inside as a data: address. */
export function buildThemeFile(theme: Omit<UserTheme, 'id' | 'image'>, image: string | null): string {
  return JSON.stringify(
    {
      format: THEME_FORMAT,
      version: 1,
      name: theme.name,
      colors: theme.colors,
      background: { mode: theme.bg, ...theme.look, ...(image ? { image } : {}) }
    },
    null,
    2
  )
}

export type ParsedTheme = Omit<UserTheme, 'id' | 'image'> & { image: string | null }

/**
 * Reads a theme file. The text comes from anywhere (a file the user picked, maybe from someone
 * else): only known fields with valid values get through, the rest is dropped.
 */
export function parseThemeFile(text: string, fallbackName: string): { ok: true; theme: ParsedTheme } | { ok: false; error: 'format' | 'colors' } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'format' }
  }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!o || o.format !== THEME_FORMAT) return { ok: false, error: 'format' }
  const colors = cleanColors(o.colors)
  if (!colors) return { ok: false, error: 'colors' }
  const bgRaw = o.background && typeof o.background === 'object' ? (o.background as Record<string, unknown>) : {}
  const image = typeof bgRaw.image === 'string' && bgRaw.image.length <= IMAGE_MAX_CHARS && IMAGE_URL.test(bgRaw.image) ? bgRaw.image : null
  let bg: BgMode = isBgMode(bgRaw.mode) ? bgRaw.mode : 'plain'
  // a picture background without its picture is no background
  if (bg === 'image' && !image) bg = 'plain'
  return { ok: true, theme: { name: cleanName(o.name, fallbackName), colors, bg, look: cleanLook(bgRaw), image } }
}

/** A name for a file: no characters Windows refuses. */
export const fileNameOf = (name: string): string => (name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'theme') + THEME_EXT
