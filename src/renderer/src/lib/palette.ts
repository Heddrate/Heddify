/**
 * Colour palettes from three anchor colours (background, text, accent). Pure: no DOM, so
 * tests can check the maths. A palette fills every CSS variable the theme stylesheet uses.
 */

export interface Anchors {
  bg: string
  text: string
  accent: string
}

export const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Accepts #rgb and #rrggbb; anything else is an error. */
export function parseHex(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`not a colour: ${hex}`)
  const full = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

const toHex = (c: [number, number, number]): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** `t` is the share of `b`: 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  const f = (x: number, y: number): number => x + (y - x) * t
  return toHex([f(ar, br), f(ag, bg), f(ab, bb)])
}

const rgba = (hex: string, alpha: number): string => `rgba(${parseHex(hex).join(', ')}, ${alpha})`

/** Relative luminance, as in WCAG (0 for black, 1 for white). */
export function luminance(hex: string): number {
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = parseHex(hex).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio: 1 (no difference) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Light text on a darker background is a dark scheme (the window chrome and form controls follow). */
export const isDarkScheme = ({ bg, text }: Anchors): boolean => luminance(text) > luminance(bg)

/** Every variable a palette sets, with its value. Keys are the CSS names without the `--`. */
export function derivePalette(a: Anchors): Record<string, string> {
  const { bg, text, accent } = a
  const dark = isDarkScheme(a)
  // a step from the background toward the text: panels, rows, hover states
  const on = (k: number): string => mix(bg, text, k)
  // the text toned down toward the background: secondary and tertiary text
  const fade = (k: number): string => mix(text, bg, k)
  return {
    bg,
    panel: on(0.04),
    'panel-2': on(0.06),
    raised: on(0.09),
    hover: on(0.13),
    'hover-2': on(0.18),
    line: on(0.12),
    'line-2': on(0.26),
    text,
    'text-2': fade(0.22),
    'text-3': fade(0.42),
    danger: dark ? '#ff7a6b' : '#c62f22',
    tile: on(0.11),
    'tile-hover': on(0.16),
    menu: on(0.12),
    'menu-hover': on(0.2),
    track: on(0.3),
    'track-buffer': on(0.4),
    'round-btn': bg,
    'outline-btn': on(0.5),
    'input-hover': on(0.35),
    'switch-off': on(0.35),
    'switch-off-hover': on(0.45),
    scroll: rgba(text, 0.2),
    'scroll-hover': rgba(text, 0.34),
    'spinner-track': rgba(text, 0.14),
    'pill-bg': bg,
    'toast-bg': text,
    'toast-ink': bg,
    'play-ink': bg,
    'shadow-art': dark ? '0 8px 24px rgba(0, 0, 0, 0.45)' : '0 6px 18px rgba(0, 0, 0, 0.14)',
    'shadow-cover': dark ? '0 4px 60px rgba(0, 0, 0, 0.5)' : '0 6px 32px rgba(0, 0, 0, 0.18)',
    'head-mix': dark ? '100%' : '30%',
    'head-shade-to': dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0)',
    'head-fade-from': dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.35)',
    'sticky-shade': dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.35)',
    accent,
    'accent-hover': mix(accent, dark ? '#ffffff' : '#000000', 0.12),
    'accent-ink': contrast(accent, '#000000') >= contrast(accent, '#ffffff') ? '#000000' : '#ffffff',
    // accent as text (the current track's title) only if it reads on the background
    'accent-text': contrast(accent, bg) >= 4.5 ? accent : text
  }
}
