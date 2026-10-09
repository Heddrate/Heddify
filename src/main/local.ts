/**
 * Music files from the user's own folders: scanned for tags (music-metadata), covers saved
 * to userData/local-covers, and served to the player as `heddify-local://track/<key>` with
 * byte ranges (seeking). Only files from the index are served — never an arbitrary path.
 */
import { app, dialog, protocol, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { Readable } from 'node:stream'
import type { LocalScan, LocalTrack } from '../shared/ipc'
import { store } from './store'
import { log } from './soundcloud'

export const LOCAL_SCHEME = 'heddify-local'

const AUDIO: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm'
}
const MAX_FILES = 20_000

interface Entry extends LocalTrack {
  path: string
  mtime: number
  cover?: string
}

let index: Record<string, Entry> | null = null
let scanning: Promise<LocalScan> | null = null

const indexFile = (): string => join(app.getPath('userData'), 'local-index.json')
const coverDir = (): string => join(app.getPath('userData'), 'local-covers')
const keyOf = (path: string): string => createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)

export const folders = (): string[] => {
  const f = store.getPrefs().musicFolders
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : []
}

async function load(): Promise<Record<string, Entry>> {
  if (index) return index
  try {
    index = JSON.parse(await fs.readFile(indexFile(), 'utf8')) as Record<string, Entry>
  } catch {
    index = {}
  }
  return index
}

async function save(): Promise<void> {
  if (index) await fs.writeFile(indexFile(), JSON.stringify(index)).catch(() => undefined)
}

const publicTrack = (e: Entry): LocalTrack => ({
  key: e.key,
  title: e.title,
  artist: e.artist,
  album: e.album,
  duration: e.duration,
  hasCover: !!e.cover,
  addedAt: e.addedAt
})

export async function localTracks(): Promise<LocalTrack[]> {
  const idx = await load()
  return Object.values(idx)
    .sort((a, b) => b.addedAt - a.addedAt)
    .map(publicTrack)
}

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 12 || out.length >= MAX_FILES) return
  let items: import('node:fs').Dirent[]
  try {
    items = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const it of items) {
    if (out.length >= MAX_FILES) return
    if (it.name.startsWith('.') || it.name.startsWith('$')) continue
    const p = join(dir, it.name)
    if (it.isDirectory()) await walk(p, out, depth + 1)
    else if (it.isFile() && AUDIO[extname(it.name).toLowerCase()]) out.push(p)
  }
}

/** "Artist - Title.mp3" → both; anything else → the file name as the title. */
function fromName(path: string): { artist: string; title: string } {
  const name = basename(path, extname(path)).replace(/_/g, ' ').trim()
  const m = name.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: name }
}

async function readTags(path: string, key: string): Promise<Partial<Entry>> {
  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseFile(path, { duration: false, skipPostHeaders: true })
    const c = meta.common
    let cover: string | undefined
    const pic = c.picture?.[0]
    if (pic?.data?.length && pic.data.length < 4_000_000) {
      const ext = pic.format.includes('png') ? '.png' : '.jpg'
      await fs.mkdir(coverDir(), { recursive: true })
      cover = key + ext
      await fs.writeFile(join(coverDir(), cover), pic.data)
    }
    return {
      title: c.title?.trim() || undefined,
      artist: (c.artists?.join(', ') || c.artist || c.albumartist || '').trim() || undefined,
      album: c.album?.trim() || undefined,
      duration: meta.format.duration ? Math.round(meta.format.duration * 1000) : 0,
      cover
    }
  } catch {
    return {}
  }
}

/** Re-reads the folders: new and changed files get their tags, removed ones leave the index. */
export function scanLocal(onProgress?: (done: number, total: number) => void): Promise<LocalScan> {
  if (scanning) return scanning
  scanning = (async () => {
    const idx = await load()
    const files: string[] = []
    for (const f of folders()) await walk(f, files)
    const seen = new Set<string>()
    let added = 0
    for (let i = 0; i < files.length; i++) {
      const path = files[i]
      const key = keyOf(path)
      seen.add(key)
      let mtime = 0
      try {
        mtime = (await fs.stat(path)).mtimeMs
      } catch {
        continue
      }
      const old = idx[key]
      if (old && old.mtime === mtime && old.path === path) continue
      const tags = await readTags(path, key)
      const name = fromName(path)
      idx[key] = {
        key,
        path,
        mtime,
        title: tags.title ?? name.title,
        artist: tags.artist ?? name.artist,
        album: tags.album ?? '',
        duration: tags.duration ?? 0,
        cover: tags.cover,
        hasCover: !!tags.cover,
        addedAt: old?.addedAt ?? Date.now()
      }
      if (!old) added++
      if (i % 25 === 0) onProgress?.(i + 1, files.length)
    }
    let removed = 0
    for (const key of Object.keys(idx)) {
      if (!seen.has(key)) {
        const c = idx[key].cover
        if (c) await fs.rm(join(coverDir(), c), { force: true }).catch(() => undefined)
        delete idx[key]
        removed++
      }
    }
    await save()
    log(`local scan: ${files.length} files, +${added} -${removed}`)
    return { total: Object.keys(idx).length, added, removed }
  })().finally(() => {
    scanning = null
  })
  return scanning
}

export async function addFolder(win: BrowserWindow | null): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'], title: store.getPrefs().lang === 'en' ? 'Music folder' : 'Папка с музыкой' }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const dir = res.canceled ? null : res.filePaths[0]
  if (!dir) return null
  const list = folders()
  if (!list.some((f) => f.toLowerCase() === dir.toLowerCase())) store.setPrefs({ musicFolders: [...list, dir] })
  return dir
}

export function removeFolder(dir: string): void {
  store.setPrefs({ musicFolders: folders().filter((f) => f !== dir) })
}

/** Serves indexed files (and their covers) with HTTP range support. Call after 'ready'. */
export function serveLocal(): void {
  protocol.handle(LOCAL_SCHEME, async (req) => {
    const url = new URL(req.url)
    const key = decodeURIComponent(url.pathname.replace(/^\//, '')).replace(/\.\w+$/, '')
    const e = (await load())[key]
    if (!e) return new Response(null, { status: 404 })
    const cover = url.host === 'cover'
    if (cover && !e.cover) return new Response(null, { status: 404 })
    const path = cover ? join(coverDir(), e.cover!) : e.path
    const mime = cover ? (e.cover!.endsWith('.png') ? 'image/png' : 'image/jpeg') : (AUDIO[extname(e.path).toLowerCase()] ?? 'application/octet-stream')
    let size: number
    try {
      size = (await fs.stat(path)).size
    } catch {
      return new Response(null, { status: 404 })
    }
    const m = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
    let start = 0
    let end = size - 1
    if (m) {
      if (m[1]) start = Number(m[1])
      if (m[2]) end = m[1] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (!m[1] && m[2]) start = Math.max(0, size - Number(m[2]))
    }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    }
    if (m) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    return new Response(body, { status: m ? 206 : 200, headers })
  })
}
