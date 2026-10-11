import { describe, expect, it } from 'vitest'
import { contrast, derivePalette, isDarkScheme, luminance, mix, parseHex } from '../src/renderer/src/lib/palette'

const PRESETS = {
  azure: { bg: '#000f0f', text: '#e8f5fb', accent: '#68c7ec' },
  asphalt: { bg: '#302f2c', text: '#efede3', accent: '#efede3' },
  paper: { bg: '#efede3', text: '#302f2c', accent: '#302f2c' },
  sunset: { bg: '#c94a1c', text: '#fffdf2', accent: '#ec5e27' },
  pine: { bg: '#00311f', text: '#fffdf2', accent: '#fffdf2' }
}

describe('parseHex', () => {
  it('reads #rrggbb and #rgb', () => {
    expect(parseHex('#68c7ec')).toEqual([0x68, 0xc7, 0xec])
    expect(parseHex('#fff')).toEqual([255, 255, 255])
  })

  it('rejects anything that is not a colour', () => {
    expect(() => parseHex('red')).toThrow()
    expect(() => parseHex('#12345')).toThrow()
  })
})

describe('mix', () => {
  it('gives the first colour at 0 and the second at 1', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('mixes half-and-half in the middle', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('contrast and luminance', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5)
  })

  it('orders black below white', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('isDarkScheme', () => {
  it('treats light text on a darker background as dark', () => {
    expect(isDarkScheme({ bg: '#0b0b0b', text: '#f2f2f2', accent: '#ffffff' })).toBe(true)
    expect(isDarkScheme({ bg: '#e9e9e9', text: '#121212', accent: '#121212' })).toBe(false)
  })
})

describe('derivePalette', () => {
  it('sets every variable the theme stylesheet uses', () => {
    const vars = derivePalette(PRESETS.azure)
    const used = [
      'bg', 'panel', 'panel-2', 'raised', 'hover', 'hover-2', 'line', 'line-2', 'text', 'text-2', 'text-3', 'danger',
      'tile', 'tile-hover', 'menu', 'menu-hover', 'track', 'track-buffer', 'round-btn', 'outline-btn', 'input-hover',
      'switch-off', 'switch-off-hover', 'scroll', 'scroll-hover', 'spinner-track', 'pill-bg', 'toast-bg', 'toast-ink',
      'play-ink', 'shadow-art', 'shadow-cover', 'head-mix', 'head-shade-to', 'head-fade-from', 'sticky-shade', 'accent',
      'accent-hover', 'accent-ink', 'accent-text'
    ]
    for (const key of used) expect(vars, key).toHaveProperty(key)
    expect(Object.keys(vars)).toHaveLength(used.length)
  })

  it('keeps the anchors as they are', () => {
    for (const p of Object.values(PRESETS)) {
      const vars = derivePalette(p)
      expect(vars.bg).toBe(p.bg)
      expect(vars.text).toBe(p.text)
      expect(vars.accent).toBe(p.accent)
    }
  })

  it('makes every preset readable: main text and the accent label on the background', () => {
    for (const [name, p] of Object.entries(PRESETS)) {
      expect(contrast(p.text, p.bg), name).toBeGreaterThanOrEqual(4.5)
      const vars = derivePalette(p)
      expect(contrast(vars['text-2'], p.bg), name).toBeGreaterThanOrEqual(3)
      expect(contrast(vars['accent-ink'], vars.accent), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('moves panels a step from the background, toward the text', () => {
    const dark = derivePalette(PRESETS.azure)
    expect(luminance(dark.panel)).toBeGreaterThan(luminance(dark.bg))
    const light = derivePalette(PRESETS.paper)
    expect(luminance(light.panel)).toBeLessThan(luminance(light.bg))
  })

  it('falls back to the text colour for accent text that does not read on the background', () => {
    // a dark accent on a dark background is unreadable as text
    const vars = derivePalette({ bg: '#0b0b0b', text: '#f2f2f2', accent: '#202020' })
    expect(vars['accent-text']).toBe('#f2f2f2')
  })
})
