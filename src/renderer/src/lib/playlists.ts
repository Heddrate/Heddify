/**
 * The app's own playlists: tracks from SoundCloud, Yandex Music and Audius side by side,
 * which none of the services can do. Stored in the app (prefs), no account needed.
 */
import { create } from 'zustand'
import type { Track } from './types'
import { tx } from './i18n'
import { downloadTracks } from './offline'
import { whenBridge } from './bridge'
import { navigate, useApp } from '@/store/app'
import { slim } from '@/store/player'
import { askConfirm, askText, openMenu, openMenuAt, toast, useMenu, type MenuItem } from '@/store/ui'

export interface LocalPlaylist {
  id: string
  title: string
  tracks: Track[]
  /** Own cover picked by the user (a small JPEG data URL); else a collage of the tracks. */
  cover?: string
  /** Downloaded for offline listening: tracks added later are downloaded too. */
  offline?: boolean
  createdAt: number
  updatedAt: number
}

interface State {
  loaded: boolean
  lists: LocalPlaylist[]
}

export const usePlaylists = create<State>(() => ({ loaded: false, lists: [] }))

const KEY = 'localPlaylists'

whenBridge(() => {
  void window.sc.prefs.get().then((p) => {
    const lists = Array.isArray(p[KEY]) ? (p[KEY] as LocalPlaylist[]).filter((l) => l?.id && Array.isArray(l.tracks)) : []
    usePlaylists.setState({ loaded: true, lists })
  })
})

function save(lists: LocalPlaylist[]): void {
  usePlaylists.setState({ lists })
  void window.sc.prefs.set({ [KEY]: lists })
}

const update = (id: string, fn: (l: LocalPlaylist) => LocalPlaylist): void =>
  save(usePlaylists.getState().lists.map((l) => (l.id === id ? { ...fn(l), updatedAt: Date.now() } : l)))

export const getPlaylist = (id: string): LocalPlaylist | undefined => usePlaylists.getState().lists.find((l) => l.id === id)

/** Asks for a name and creates a playlist (optionally with tracks); returns its id. */
export async function createPlaylist(tracks: Track[] = [], open = true): Promise<string | null> {
  const n = usePlaylists.getState().lists.length + 1
  const title = await askText(tx('Новый плейлист'), tx('Мой плейлист №{0}', n), tx('Создать'))
  if (!title) return null
  const now = Date.now()
  const list: LocalPlaylist = { id: `pl-${now.toString(36)}`, title, tracks: tracks.map(slim), createdAt: now, updatedAt: now }
  save([list, ...usePlaylists.getState().lists])
  if (tracks.length) toast(tx('Создан плейлист «{0}»', title))
  if (open) navigate({ name: 'local', id: list.id })
  return list.id
}

export function addToPlaylist(id: string, tracks: Track[]): void {
  const list = getPlaylist(id)
  if (!list) return
  const have = new Set(list.tracks.map((t) => t.id))
  const fresh = tracks.filter((t) => !have.has(t.id))
  if (!fresh.length) {
    toast(tx('Уже в плейлисте «{0}»', list.title))
    return
  }
  update(id, (l) => ({ ...l, tracks: [...l.tracks, ...fresh.map(slim)] }))
  if (list.offline) void downloadTracks(fresh)
  toast(fresh.length === 1 ? tx('Добавлено в «{0}»', list.title) : tx('{0} треков добавлено в «{1}»', fresh.length, list.title))
}

export function removeFromPlaylist(id: string, index: number): void {
  update(id, (l) => ({ ...l, tracks: l.tracks.filter((_, i) => i !== index) }))
}

export function moveInPlaylist(id: string, from: number, to: number): void {
  update(id, (l) => {
    if (to < 0 || to >= l.tracks.length) return l
    const tracks = l.tracks.slice()
    const [t] = tracks.splice(from, 1)
    tracks.splice(to, 0, t)
    return { ...l, tracks }
  })
}

export async function renamePlaylist(id: string): Promise<void> {
  const list = getPlaylist(id)
  if (!list) return
  const title = await askText(tx('Название плейлиста'), list.title, tx('Сохранить'))
  if (title && title !== list.title) update(id, (l) => ({ ...l, title }))
}

export async function deletePlaylist(id: string): Promise<void> {
  const list = getPlaylist(id)
  if (!list) return
  const ok = await askConfirm(tx('Удалить плейлист?'), tx('«{0}» исчезнет из приложения. Сами треки останутся в своих сервисах.', list.title), tx('Удалить'), true)
  if (!ok) return
  save(usePlaylists.getState().lists.filter((l) => l.id !== id))
  const r = useApp.getState().route
  if (r.name === 'local' && r.id === id) navigate({ name: 'home' }, true)
}

function playlistItems(tracks: Track[]): MenuItem[] {
  return [
    { label: tx('Новый плейлист'), icon: 'add', onSelect: () => void createPlaylist(tracks, false) },
    ...(usePlaylists.getState().lists.length ? [{ separator: true } as const] : []),
    ...usePlaylists.getState().lists.map((l) => ({ label: l.title, icon: 'queue' as const, onSelect: () => addToPlaylist(l.id, tracks) }))
  ]
}

/** "Добавить в плейлист" — a second menu where the first one was, listing the playlists. */
export function addToPlaylistMenu(tracks: Track[]): void {
  const { x, y } = useMenu.getState()
  // let the first menu close before the second opens
  setTimeout(() => openMenu({ x, y }, playlistItems(tracks)), 0)
}

/** The same list under a button (the "+" on a track row). */
export function addToPlaylistMenuAt(el: Element, tracks: Track[]): void {
  openMenuAt(el, playlistItems(tracks))
}

/** Drag and drop: a dragged track row carries its (slim) track under this type. */
export const TRACK_MIME = 'application/x-heddify-track'

export function draggedTrack(e: React.DragEvent): Track | null {
  try {
    const t = JSON.parse(e.dataTransfer.getData(TRACK_MIME)) as Track
    return t && typeof t.id === 'number' ? t : null
  } catch {
    return null
  }
}

/** Up to four covers for a playlist's collage. */
export function playlistCovers(l: LocalPlaylist): string[] {
  const out: string[] = []
  for (const t of l.tracks) {
    const a = t.artwork_url || t.user?.avatar_url
    if (a && !out.includes(a)) out.push(a)
    if (out.length === 4) break
  }
  return out
}

export function setPlaylistOffline(id: string, offline: boolean): void {
  update(id, (l) => ({ ...l, offline }))
}

/** Square-crops and shrinks an image file to a small JPEG data URL for a cover. */
async function toCover(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const size = 600
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.86)
}

/** Opens a file picker and sets the chosen image as the playlist's cover. */
export function pickPlaylistCover(id: string): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const cover = await toCover(file)
      update(id, (l) => ({ ...l, cover }))
    } catch {
      toast(tx('Не получилось открыть картинку'))
    }
  }
  input.click()
}

export function removePlaylistCover(id: string): void {
  update(id, (l) => ({ ...l, cover: undefined }))
}