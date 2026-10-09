/**
 * Audio cache: tracks that were played are saved to disk in the background and play from
 * there next time — instantly, with less traffic, and even when the network is down.
 *
 * Files live in userData/cache/audio with a small JSON index; least recently played
 * tracks are evicted once the size limit (Settings → Cache) is reached. The renderer gets
 * cached tracks as `scp-cache://audio/<key>` URLs served with byte ranges, so seeking works.
 */
import { app, net, protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { CacheStats, CachedTrack, StreamInfo, StreamRequest } from '../shared/ipc'
import { log } from './soundcloud'
import { store } from './store'

export const CACHE_SCHEME = 'scp-cache'

const DEFAULT_LIMIT_MB = 1024
/** Never cache a single file bigger than this share of the limit (hour-long DJ mixes). */
const MAX_SHARE = 0.25
/** Let playback buffer first; the cache download waits this long after a track starts. */
const START_DELAY_MS = 8000

interface Entry {
  file: string
  mime: string
  size: number
  used: number
  /** Track as the renderer knows it, for the offline list. */
  meta?: unknown
  /** Downloaded on purpose ("Скачать"): never evicted, doesn't count toward the limit. */
  pinned?: boolean
}

const dir = (): string => join(app.getPath('userData'), 'cache', 'audio')
const indexFile = (): string => join(dir(), 'index.json')

let index: Record<string, Entry> | null = null
let saveTimer: NodeJS.Timeout | undefined

async function load(): Promise<Record<string, Entry>> {
  if (index) return index
  try {
    index = JSON.parse(await fs.readFile(indexFile(), 'utf8')) as Record<string, Entry>
  } catch {
    index = {}
  }
  return index
}

function save(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const data = JSON.stringify(index ?? {})
    void fs
      .mkdir(dir(), { recursive: true })
      .then(() => fs.writeFile(indexFile() + '.tmp', data))
      .then(() => fs.rename(indexFile() + '.tmp', indexFile()))
      .catch((e: unknown) => log(`cache index: ${String(e)}`))
  }, 1000)
}

export const cacheEnabled = (): boolean => store.getPrefs().cacheEnabled !== false

function limitBytes(): number {
  const mb = Number(store.getPrefs().cacheLimitMb)
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_LIMIT_MB) * 1024 * 1024
}

/** Must run before app 'ready': lets <audio> stream and seek in cached files. */
export function registerCacheScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: CACHE_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

/** The cached copy of a track, as a stream the player can use directly. */
export async function cachedStream(key: string): Promise<StreamInfo | null> {
  if (!cacheEnabled()) return null
  const idx = await load()
  const e = idx[key]
  if (!e) return null
  try {
    await fs.access(join(dir(), e.file))
  } catch {
    delete idx[key]
    save()
    return null
  }
  e.used = Date.now()
  save()
  return { url: `${CACHE_SCHEME}://audio/${encodeURIComponent(key)}`, protocol: 'progressive', mime: e.mime, snipped: false, cached: true }
}

/** Forget a cached file (it failed to play, or the user wants a fresh copy). */
export async function dropCached(key: string): Promise<void> {
  const idx = await load()
  const e = idx[key]
  if (!e) return
  delete idx[key]
  save()
  await fs.rm(join(dir(), e.file), { force: true }).catch(() => undefined)
}

/* ---------- filling ---------- */

interface Job {
  key: string
  info: StreamInfo
  meta?: unknown
  pinned?: boolean
}

const queue: Job[] = []
let busy = false

/** Called after a stream was resolved for playback: save it in the background. */
export function rememberStream(key: string, info: StreamInfo, meta?: unknown): void {
  if (!cacheEnabled() || info.snipped || info.cached) return
  if (index?.[key] || queue.some((q) => q.key === key)) return
  queue.push({ key, info, meta })
  // skipping through a list shouldn't pile up downloads; keep the latest few
  while (queue.length > 6) queue.shift()
  void pump()
}

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  try {
    while (queue.length) {
      await new Promise((r) => setTimeout(r, START_DELAY_MS))
      const job = queue.shift()
      if (!job) break
      try {
        await download(job)
      } catch (e) {
        log(`cache ${job.key}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } finally {
    busy = false
  }
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const r = await net.fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

/** Segment URLs of an HLS playlist, init segment first; byte ranges of one file count once. */
function segmentUris(playlist: string, base: string): string[] {
  const uris: string[] = []
  for (const raw of playlist.split('\n')) {
    const line = raw.trim()
    const map = line.startsWith('#EXT-X-MAP') ? line.match(/URI="([^"]+)"/) : null
    const uri = map ? map[1] : line && !line.startsWith('#') ? line : null
    if (!uri) continue
    const abs = new URL(uri, base).toString()
    if (!uris.includes(abs)) uris.push(abs)
  }
  return uris
}

function fileType(mime: string): { mime: string; ext: string } {
  if (/ogg|opus/i.test(mime)) return { mime: 'audio/ogg', ext: 'ogg' }
  if (/mp4|aac|m4a/i.test(mime)) return { mime: 'audio/mp4', ext: 'm4a' }
  return { mime: 'audio/mpeg', ext: 'mp3' }
}

async function download({ key, info, meta, pinned }: Job): Promise<void> {
  const idx = await load()
  if (idx[key] || (!cacheEnabled() && !pinned)) return

  let data: Buffer
  let mime = info.mime
  if (info.protocol === 'progressive') {
    const r = await net.fetch(info.url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    data = Buffer.from(await r.arrayBuffer())
    mime = r.headers.get('content-type') || mime
  } else {
    const r = await net.fetch(info.url)
    if (!r.ok) throw new Error(`playlist HTTP ${r.status}`)
    const uris = segmentUris(await r.text(), info.url)
    if (!uris.length) throw new Error('empty playlist')
    const parts: Buffer[] = new Array(uris.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < uris.length) {
        const i = next++
        parts[i] = await fetchBuffer(uris[i])
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, uris.length) }, worker))
    data = Buffer.concat(parts)
  }

  if (data.length < 16 * 1024) throw new Error('too small')
  if (!pinned && data.length > limitBytes() * MAX_SHARE) return

  const type = fileType(mime)
  const file = `${key.replace(/[^a-z0-9-]/gi, '_')}.${type.ext}`
  await fs.mkdir(dir(), { recursive: true })
  await fs.writeFile(join(dir(), file + '.part'), data)
  await fs.rename(join(dir(), file + '.part'), join(dir(), file))
  idx[key] = { file, mime: type.mime, size: data.length, used: Date.now(), meta, pinned }
  await evict()
  save()
}

/** Drops least recently played files until the cache fits its limit. */
async function evict(): Promise<void> {
  const idx = await load()
  const limit = limitBytes()
  let total = Object.values(idx).reduce((s, e) => s + (e.pinned ? 0 : e.size), 0)
  if (total <= limit) return
  const oldest = Object.entries(idx)
    .filter(([, e]) => !e.pinned)
    .sort((a, b) => a[1].used - b[1].used)
  for (const [key, e] of oldest) {
    if (total <= limit) break
    delete idx[key]
    total -= e.size
    await fs.rm(join(dir(), e.file), { force: true }).catch(() => undefined)
  }
  save()
}

/* ---------- downloads ("Скачать") ---------- */

type Resolver = (req: StreamRequest) => Promise<{ ok: true; data: StreamInfo } | { ok: false; error?: string }>
type Progress = (p: { done: number; total: number; failed: number }) => void

const pinQueue: StreamRequest[] = []
let pinBusy = false
let pinTotal = 0
let pinDone = 0
let pinFailed = 0

export const cacheKey = (req: StreamRequest): string => (req.audius ? `au-${req.audius}` : `sc-${Number(req.id)}`)

/**
 * Downloads tracks for offline listening and pins them (never evicted). Already cached
 * tracks are just pinned. SoundCloud requests are spaced out so a big playlist doesn't
 * look like a bot to its anti-bot service.
 */
export async function pinTracks(reqs: StreamRequest[], resolve: Resolver, progress: Progress): Promise<void> {
  const idx = await load()
  for (const req of reqs) {
    const e = idx[cacheKey(req)]
    if (e) {
      e.pinned = true
      e.meta = req.meta ?? e.meta
    } else if (!pinQueue.some((q) => cacheKey(q) === cacheKey(req))) {
      pinQueue.push(req)
      pinTotal++
    }
  }
  save()
  progress({ done: pinDone, total: pinTotal, failed: pinFailed })
  if (pinBusy) return
  pinBusy = true
  try {
    while (pinQueue.length) {
      const req = pinQueue.shift()!
      try {
        const res = await resolve(req)
        if (!res.ok) throw new Error(res.error ?? 'no stream')
        if (res.data.snipped) throw new Error('preview only')
        await download({ key: cacheKey(req), info: res.data, meta: req.meta, pinned: true })
        if (!(await load())[cacheKey(req)]) throw new Error('not saved')
      } catch (e) {
        pinFailed++
        log(`download ${cacheKey(req)}: ${e instanceof Error ? e.message : String(e)}`)
      }
      pinDone++
      progress({ done: pinDone, total: pinTotal, failed: pinFailed })
      if (!req.audius && pinQueue.length) await new Promise((r) => setTimeout(r, 1500))
    }
  } finally {
    pinBusy = false
    pinTotal = pinDone = pinFailed = 0
  }
}

/** Cached tracks that carry metadata: downloads first, then the most recently played. */
export async function listCached(): Promise<CachedTrack[]> {
  const idx = await load()
  return Object.entries(idx)
    .filter(([, e]) => e.meta)
    .sort((a, b) => Number(!!b[1].pinned) - Number(!!a[1].pinned) || b[1].used - a[1].used)
    .map(([key, e]) => ({ key, meta: e.meta, pinned: !!e.pinned, size: e.size }))
}

/** "Удалить из скачанного": unpins; the file stays as ordinary cache until evicted. */
export async function unpinTracks(keys: string[]): Promise<void> {
  const idx = await load()
  for (const k of keys) if (idx[k]) idx[k].pinned = false
  save()
  await evict()
}

/* ---------- serving ---------- */

/** Serves cached files to the renderer with HTTP range support. Call after 'ready'. */
export function serveCache(): void {
  protocol.handle(CACHE_SCHEME, async (req) => {
    const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
    const e = (await load())[key]
    if (!e) return new Response(null, { status: 404 })
    const path = join(dir(), e.file)
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
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
    const headers: Record<string, string> = {
      'Content-Type': e.mime,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      // the player may route audio through Web Audio (volume leveling), which needs CORS
      'Access-Control-Allow-Origin': '*'
    }
    if (m) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    return new Response(body, { status: m ? 206 : 200, headers })
  })
}

/* ---------- settings ---------- */

export async function cacheStats(): Promise<CacheStats> {
  const idx = await load()
  const entries = Object.values(idx)
  const pinned = entries.filter((e) => e.pinned)
  return {
    bytes: entries.reduce((s, e) => s + e.size, 0),
    count: entries.length,
    pinnedBytes: pinned.reduce((s, e) => s + e.size, 0),
    pinnedCount: pinned.length,
    limitMb: limitBytes() / 1024 / 1024,
    enabled: cacheEnabled()
  }
}

export async function clearCache(): Promise<void> {
  queue.length = 0
  index = {}
  clearTimeout(saveTimer)
  await fs.rm(dir(), { recursive: true, force: true }).catch(() => undefined)
}

/** After the limit changed in settings. */
export const applyCacheLimit = (): Promise<void> => evict()
