// The user's own themes travel as ".heddify-theme" files: only valid colours and settings get in.
import { describe, expect, it } from 'vitest'
import { buildThemeFile, cleanLook, DEFAULT_LOOK, fileNameOf, LOOK_LIMITS, parseThemeFile } from '../src/renderer/src/lib/themeFile'

const colors = { bg: '#101820', text: '#f2f2f2', accent: '#ff5500' }
const look = { blur: 24, dim: 0.4, saturate: 1.2, clear: 0.5 }
const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('theme file', () => {
  it('goes there and back with its picture', () => {
    const text = buildThemeFile({ name: 'Неон', colors, bg: 'image', look }, PNG)
    const r = parseThemeFile(text, 'файл')
    expect(r).toEqual({ ok: true, theme: { name: 'Неон', colors, bg: 'image', look, image: PNG } })
  })

  it('keeps a theme without a picture', () => {
    const r = parseThemeFile(buildThemeFile({ name: 'Тихая', colors, bg: 'cover', look }, null), 'файл')
    expect(r.ok && r.theme.bg).toBe('cover')
    expect(r.ok && r.theme.image).toBeNull()
  })

  it('refuses what is not a theme', () => {
    expect(parseThemeFile('not json', 'x')).toEqual({ ok: false, error: 'format' })
    expect(parseThemeFile('{"format":"something-else"}', 'x')).toEqual({ ok: false, error: 'format' })
    expect(parseThemeFile('{"format":"heddify-theme","colors":{"bg":"red"}}', 'x')).toEqual({ ok: false, error: 'colors' })
  })

  it('drops a picture that is not an image, and its picture background with it', () => {
    const text = JSON.stringify({
      format: 'heddify-theme',
      colors,
      background: { mode: 'image', image: 'data:text/html;base64,PHNjcmlwdD4=' }
    })
    const r = parseThemeFile(text, 'x')
    expect(r.ok && r.theme.image).toBeNull()
    expect(r.ok && r.theme.bg).toBe('plain')
  })

  it('takes the file name when the theme has none, and cuts long names', () => {
    const noName = parseThemeFile(JSON.stringify({ format: 'heddify-theme', colors }), 'Из файла')
    expect(noName.ok && noName.theme.name).toBe('Из файла')
    const long = parseThemeFile(JSON.stringify({ format: 'heddify-theme', colors, name: 'x'.repeat(200) }), 'y')
    expect(long.ok && long.theme.name.length).toBe(40)
  })
})

describe('look settings', () => {
  it('stay within their limits, missing ones take the default', () => {
    expect(cleanLook({ blur: 999, dim: -1, saturate: 'a' })).toEqual({
      blur: LOOK_LIMITS.blur.max,
      dim: LOOK_LIMITS.dim.min,
      saturate: DEFAULT_LOOK.saturate,
      clear: DEFAULT_LOOK.clear
    })
    expect(cleanLook(null)).toEqual(DEFAULT_LOOK)
  })
})

describe('file name', () => {
  it('has no characters Windows refuses', () => {
    expect(fileNameOf('Ночь: "синяя" / v2')).toBe('Ночь синяя v2.heddify-theme')
    expect(fileNameOf('???')).toBe('theme.heddify-theme')
  })
})
