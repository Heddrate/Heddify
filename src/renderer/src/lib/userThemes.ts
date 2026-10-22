/**
 * The user's own themes: the current look saved under a name (colours, background, the
 * picture), put back on with one click, and shared as a ".heddify-theme" file.
 */
import { tx } from './i18n'
import { applyLook, currentAnchors, useTheme, type UserThemeId } from './theme'
import { buildThemeFile, fileNameOf, parseThemeFile, THEME_EXT, type UserTheme } from './themeFile'
import { blobToDataUrl, dataUrlToBlob, deleteImage, getImage, prepareImage, putImage, setWallpaper, themeImageKey, WALLPAPER } from './wallpaper'
import { toast } from '@/store/ui'

const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export const themeIdOf = (t: UserTheme): UserThemeId => `user:${t.id}`

/** Saves what is on now (colours, background and its picture) as a theme of its own. */
export async function saveCurrentTheme(name: string): Promise<void> {
  const { bg, look, userThemes } = useTheme.getState()
  const id = newId()
  let image = false
  if (bg === 'image') {
    const pic = await getImage(WALLPAPER).catch(() => null)
    if (pic) {
      await putImage(themeImageKey(id), pic)
      image = true
    }
  }
  const theme: UserTheme = { id, name, colors: currentAnchors(), bg: image || bg !== 'image' ? bg : 'plain', look, image }
  applyLook({ userThemes: [...userThemes, theme], theme: themeIdOf(theme) })
  toast(tx('Тема «{0}» сохранена', name))
}

/** Puts a saved theme on: its colours, its background and its picture. */
export async function applyUserTheme(theme: UserTheme): Promise<void> {
  if (theme.image) {
    const pic = await getImage(themeImageKey(theme.id)).catch(() => null)
    if (pic) await setWallpaper(pic)
  }
  applyLook({ theme: themeIdOf(theme), bg: theme.bg, look: theme.look })
}

export async function deleteUserTheme(theme: UserTheme): Promise<void> {
  const { theme: on, userThemes } = useTheme.getState()
  const active = on === themeIdOf(theme)
  // its colours stay on screen as the custom theme rather than jumping to another one
  if (active) useTheme.setState({ custom: theme.colors })
  applyLook({ userThemes: userThemes.filter((t) => t.id !== theme.id), ...(active ? { theme: 'custom' as const } : {}) })
  if (theme.image) await deleteImage(themeImageKey(theme.id)).catch(() => undefined)
}

/** Saves a theme as a file the user can keep or send (the picture goes inside). */
export async function exportUserTheme(theme: UserTheme): Promise<void> {
  const pic = theme.image ? await getImage(themeImageKey(theme.id)).catch(() => null) : null
  const text = buildThemeFile(theme, pic ? await blobToDataUrl(pic) : null)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileNameOf(theme.name)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Reads a theme file the user picked, keeps it among their themes and puts it on. */
export async function importThemeFile(file: File): Promise<void> {
  const fallback = file.name.replace(new RegExp(`(${THEME_EXT.replace('.', '\\.')}|\\.json)$`, 'i'), '') || tx('Тема')
  const parsed = parseThemeFile(await file.text(), fallback)
  if (!parsed.ok) {
    toast(parsed.error === 'colors' ? tx('В файле темы нет цветов') : tx('Это не файл темы Heddify'))
    return
  }
  const { image: data, ...rest } = parsed.theme
  const id = newId()
  let image = false
  if (data) {
    try {
      await putImage(themeImageKey(id), await prepareImage(dataUrlToBlob(data)))
      image = true
    } catch {
      /* a broken picture: the theme comes without it */
    }
  }
  const theme: UserTheme = { ...rest, id, image, bg: rest.bg === 'image' && !image ? 'plain' : rest.bg }
  useTheme.setState({ userThemes: [...useTheme.getState().userThemes, theme] })
  await applyUserTheme(theme)
  toast(tx('Тема «{0}» загружена', theme.name))
}
