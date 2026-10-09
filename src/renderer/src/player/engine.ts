import type HlsClass from 'hls.js'

/** hls.js is only needed for some SoundCloud streams: loaded on first use, not at start. */
let Hls: typeof HlsClass | null = null
const loadHls = async (): Promise<void> => {
  if (!Hls) Hls = (await import('hls.js')).default
}
import type { StreamInfo, StreamRequest } from '../../../shared/ipc'
import type { Track } from '@/lib/types'
import { tx } from '@/lib/i18n'

export interface EngineEvents {
  time(position: number, duration: number): void
  buffered(end: number): void
  state(s: { playing?: boolean; loading?: boolean }): void
  started(track: Track): void
  ended(): void
  error(message: string): void
}

const MAX_RECOVERIES = 3

/** The bits of a track worth keeping next to its cached file (offline list). */
export const trackMeta = (t: Track): Track => ({
  id: t.id,
  kind: 'track',
  title: t.title,
  user: t.user && { id: t.user.id, kind: 'user', username: t.user.username, avatar_url: t.user.avatar_url, permalink_url: t.user.permalink_url },
  artwork_url: t.artwork_url,
  duration: t.duration,
  full_duration: t.full_duration,
  permalink_url: t.permalink_url,
  genre: t.genre,
  policy: t.policy,
  origin: t.origin,
  au: t.au
})

export const streamRequest = (t: Track): StreamRequest => ({
  id: t.id,
  track_authorization: t.track_authorization,
  media: t.media,
  audius: t.au?.id,
  meta: trackMeta(t)
})

const isOgg = (s: StreamInfo): boolean => s.protocol === 'hls' && /ogg|opus/i.test(s.mime)

/**
 * Wraps a single <audio> element. Progressive MP3 plays natively; HLS (AAC/MP3)
 * goes through hls.js. Signed stream URLs expire, so on a network/media error we
 * resolve a fresh URL and continue from the same position.
 */
class Engine {
  readonly audio = new Audio()
  private hls: HlsClass | null = null
  private objectUrl: string | null = null
  private loadId = 0
  private startedFor = -1
  private track: Track | null = null
  private stream: StreamInfo | null = null
  private resolving = false
  private wantPlay = false
  private recoveries = 0
  private ev: EngineEvents | null = null
  private leveling = false
  private graph: { ctx: AudioContext; src: MediaElementAudioSourceNode; comp: DynamicsCompressorNode; makeup: GainNode } | null = null

  constructor() {
    const a = this.audio
    a.preload = 'auto'
    a.addEventListener('timeupdate', () => this.ev?.time(a.currentTime, this.duration()))
    a.addEventListener('durationchange', () => this.ev?.time(a.currentTime, this.duration()))
    a.addEventListener('progress', () => {
      const b = a.buffered
      if (b.length) this.ev?.buffered(b.end(b.length - 1))
    })
    a.addEventListener('playing', () => {
      this.ev?.state({ playing: true, loading: false })
      if (this.startedFor !== this.loadId && this.track) {
        this.startedFor = this.loadId
        this.ev?.started(this.track)
      }
    })
    a.addEventListener('pause', () => {
      if (!this.resolving) this.ev?.state({ playing: false })
    })
    a.addEventListener('waiting', () => this.ev?.state({ loading: true }))
    a.addEventListener('canplay', () => this.ev?.state({ loading: false }))
    a.addEventListener('ended', () => this.ev?.ended())
    a.addEventListener('error', () => {
      if (a.error && this.stream && !this.hls) this.recover()
    })
  }

  bind(ev: EngineEvents): void {
    this.ev = ev
  }

  duration(): number {
    const d = this.audio.duration
    if (Number.isFinite(d) && d > 0) return d
    return (this.track?.duration ?? 0) / 1000
  }

  hasSource(): boolean {
    return !!this.stream || this.resolving
  }

  isPaused(): boolean {
    return this.resolving ? !this.wantPlay : this.audio.paused
  }

  async load(track: Track, opts: { autoplay: boolean; startAt?: number }): Promise<StreamInfo | null> {
    const id = ++this.loadId
    this.track = track
    this.recoveries = 0
    this.teardown()
    this.resolving = true
    this.wantPlay = opts.autoplay
    this.ev?.state({ loading: true, playing: opts.autoplay })

    const res = await window.sc.resolveStream(streamRequest(track))
    if (id !== this.loadId) return null
    this.resolving = false
    if (!res.ok) {
      this.ev?.state({ loading: false, playing: false })
      throw new Error(res.error)
    }

    this.stream = res.data
    if (res.data.protocol === 'hls' && !isOgg(res.data)) await loadHls()
    if (id !== this.loadId) return null
    if (isOgg(res.data)) {
      // stays in "resolving" (loading) state while the segments download
      this.resolving = true
      try {
        await this.attachOgg(res.data.url, opts.startAt ?? 0, id)
      } finally {
        if (id === this.loadId) this.resolving = false
      }
      if (id !== this.loadId) return null
    } else {
      this.attach(res.data, opts.startAt ?? 0)
    }
    if (this.wantPlay) void this.play()
    else this.ev?.state({ loading: false, playing: false })
    return res.data
  }

  /**
   * Opus streams come as HLS with Ogg segments, which neither hls.js nor MSE can play.
   * They're small (~1 MB per 3 min), so download all segments and play the joined file.
   */
  private async attachOgg(url: string, startAt: number, id: number): Promise<void> {
    const playlist = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(tx("Плейлист: {0}", r.status))
      return r.text()
    })
    const uris: string[] = []
    for (const raw of playlist.split('\n')) {
      const line = raw.trim()
      const map = line.startsWith('#EXT-X-MAP') ? line.match(/URI="([^"]+)"/) : null
      const uri = map ? map[1] : line && !line.startsWith('#') ? line : null
      if (uri) {
        const abs = new URL(uri, url).toString()
        // byte-range playlists repeat one file: fetching it once covers every range
        if (!uris.includes(abs)) uris.push(abs)
      }
    }
    if (!uris.length) throw new Error(tx("Пустой плейлист"))

    const parts: ArrayBuffer[] = new Array(uris.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < uris.length && id === this.loadId) {
        const i = next++
        const r = await fetch(uris[i])
        if (!r.ok) throw new Error(tx("Сегмент: {0}", r.status))
        parts[i] = await r.arrayBuffer()
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, uris.length) }, worker))
    if (id !== this.loadId) return

    this.ensureGraph()
    this.objectUrl = URL.createObjectURL(new Blob(parts, { type: 'audio/ogg' }))
    const a = this.audio
    a.src = this.objectUrl
    if (startAt > 0) a.addEventListener('loadedmetadata', () => (a.currentTime = startAt), { once: true })
  }

  private attach(s: StreamInfo, startAt: number): void {
    this.ensureGraph()
    const a = this.audio
    const H = Hls
    if (s.protocol === 'hls' && H?.isSupported()) {
      const hls = new H({
        enableWorker: true,
        maxBufferLength: 60,
        startPosition: startAt > 0 ? startAt : -1
      })
      hls.on(H.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === H.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
        else this.recover()
      })
      hls.loadSource(s.url)
      hls.attachMedia(a)
      this.hls = hls
    } else {
      a.src = s.url
      if (startAt > 0) {
        a.addEventListener('loadedmetadata', () => (a.currentTime = startAt), { once: true })
      }
    }
  }

  private teardown(): void {
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    this.stream = null
    const a = this.audio
    a.pause()
    a.removeAttribute('src')
    a.load()
  }

  private async recover(): Promise<void> {
    const track = this.track
    if (!track || this.resolving) return
    // a downloaded Opus file never expires: a media error there is final
    if (this.recoveries >= MAX_RECOVERIES || (this.stream && isOgg(this.stream))) {
      this.ev?.error(tx("Не удалось воспроизвести трек"))
      return
    }
    this.recoveries++
    const id = this.loadId
    const position = this.audio.currentTime
    const resume = this.wantPlay || !this.audio.paused
    this.resolving = true
    this.ev?.state({ loading: true })

    // fresh: skip (and drop) a cached copy that failed, and for Audius ask another node
    const res = await window.sc.resolveStream({ ...streamRequest(track), fresh: true })
    if (id !== this.loadId) return
    this.resolving = false
    if (!res.ok) {
      this.ev?.error(res.error)
      return
    }
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
    this.stream = res.data
    if (res.data.protocol === 'hls') await loadHls()
    if (id !== this.loadId) return
    this.attach(res.data, position)
    if (resume) void this.play()
  }

  async play(): Promise<void> {
    this.wantPlay = true
    if (this.resolving) {
      this.ev?.state({ playing: true })
      return
    }
    if (this.graph?.ctx.state === 'suspended') void this.graph.ctx.resume()
    try {
      await this.audio.play()
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') this.ev?.state({ playing: false, loading: false })
    }
  }

  pause(): void {
    this.wantPlay = false
    if (this.resolving) this.ev?.state({ playing: false })
    this.audio.pause()
  }

  toggle(): void {
    if (this.isPaused()) void this.play()
    else this.pause()
  }

  seek(t: number): void {
    if (!Number.isFinite(t)) return
    this.audio.currentTime = Math.max(0, Math.min(t, this.duration() || t))
  }

  /**
   * "Выравнивать громкость": a gentle compressor so quiet and loud uploads sit closer.
   * Web Audio needs CORS-clean media, so the graph is built before the next track loads
   * (switching it on applies from the next track; off applies at once).
   */
  setLeveling(on: boolean): void {
    this.leveling = on
    if (on) this.audio.crossOrigin = 'anonymous'
    if (this.graph) this.connectGraph()
  }

  private ensureGraph(): void {
    if (!this.leveling || this.graph) return
    const ctx = new AudioContext()
    const src = ctx.createMediaElementSource(this.audio)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24
    comp.knee.value = 24
    comp.ratio.value = 4
    comp.attack.value = 0.005
    comp.release.value = 0.3
    const makeup = ctx.createGain()
    makeup.gain.value = 1.35
    this.graph = { ctx, src, comp, makeup }
    this.connectGraph()
  }

  private connectGraph(): void {
    const g = this.graph
    if (!g) return
    g.src.disconnect()
    g.comp.disconnect()
    g.makeup.disconnect()
    if (this.leveling) {
      g.src.connect(g.comp)
      g.comp.connect(g.makeup)
      g.makeup.connect(g.ctx.destination)
    } else {
      g.src.connect(g.ctx.destination)
    }
  }

  setVolume(volume: number, muted: boolean): void {
    // squared curve feels linear to the ear
    this.audio.volume = Math.max(0, Math.min(1, volume * volume))
    this.audio.muted = muted
  }

  stop(): void {
    this.loadId++
    this.resolving = false
    this.wantPlay = false
    this.track = null
    this.teardown()
  }
}

export const engine = new Engine()
