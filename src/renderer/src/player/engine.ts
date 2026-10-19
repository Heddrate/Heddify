import type HlsClass from 'hls.js'

/** hls.js is only needed for some SoundCloud streams: loaded on first use, not at start. */
let Hls: typeof HlsClass | null = null
const loadHls = async (): Promise<void> => {
  if (!Hls) Hls = (await import('hls.js')).default
}
import type { StreamInfo, StreamRequest } from '../../../shared/ipc'
import type { Track } from '@/lib/types'
import { tx } from '@/lib/i18n'
import { fadeGain } from './audioMath'
import { recovery } from './recovery'
import { BASS_FFT, bassBinRange, bassDb, initialBass, stepBass, type BassState } from '../lib/bass'

export interface EngineEvents {
  time(position: number, duration: number): void
  buffered(end: number): void
  state(s: { playing?: boolean; loading?: boolean }): void
  started(track: Track): void
  ended(): void
  error(message: string): void
}

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
 * Wraps the <audio> element (and a plain spare for radio, see `bare`). Progressive MP3
 * plays natively; HLS (AAC/MP3) goes through hls.js. Signed stream URLs expire, so on a
 * network/media error we resolve a fresh URL and continue from the same position (a radio
 * station or an own file loads its one address again).
 */
class Engine {
  /** Everything plays here; Web Audio (leveling, bass glow) takes it over once switched on. */
  private readonly main = new Audio()
  /**
   * Once Web Audio has the main element it loads with CORS, and a radio server without CORS
   * headers is refused there. Such a station breaks and comes back on this plain element,
   * outside Web Audio: it plays, just with no glow and no leveling.
   */
  private readonly bare = new Audio()
  /** The element in use: `main`, or `bare` for a station that fell back to it. */
  private audio = this.main
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
  /** "Подсветка баса": the cover glows with the bass, from the next track on. */
  /** "Подсветка баса": how strong the glow is, 0 = off. Applies at once (the playing track reloads). */
  private glow = 0
  private freq = new Float32Array(0)
  private bassState: BassState = initialBass()
  private graph: {
    ctx: AudioContext
    src: MediaElementAudioSourceNode
    comp: DynamicsCompressorNode
    makeup: GainNode
    analyser: AnalyserNode
  } | null = null
  private level = 0.8
  private muted = false
  private fade = false
  private fadeTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    for (const a of [this.main, this.bare]) {
      a.preload = 'auto'
      // only the element in use speaks: the other one is idle, or still being emptied
      const on = (type: string, fn: () => void): void =>
        a.addEventListener(type, () => {
          if (a === this.audio) fn()
        })
      on('timeupdate', () => this.ev?.time(a.currentTime, this.duration()))
      on('durationchange', () => this.ev?.time(a.currentTime, this.duration()))
      on('progress', () => {
        const b = a.buffered
        if (b.length) this.ev?.buffered(b.end(b.length - 1))
      })
      on('playing', () => {
        this.ev?.state({ playing: true, loading: false })
        if (this.startedFor !== this.loadId && this.track) {
          this.startedFor = this.loadId
          this.ev?.started(this.track)
        }
      })
      on('pause', () => {
        if (!this.resolving) this.ev?.state({ playing: false })
      })
      on('waiting', () => this.ev?.state({ loading: true }))
      on('canplay', () => this.ev?.state({ loading: false }))
      on('ended', () => this.ev?.ended())
      on('error', () => {
        if (a.error && this.stream && !this.hls) void this.recover()
      })
    }
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
    // every track, a station too, starts on the main element (with glow if CORS lets it)
    this.audio = this.main
    this.resolving = true
    this.wantPlay = opts.autoplay
    this.ev?.state({ loading: true, playing: opts.autoplay })

    // a radio station is a direct stream and an own file is served by main: nothing to resolve or cache
    const res: Awaited<ReturnType<typeof window.sc.resolveStream>> = track.radio
      ? { ok: true, status: 200, data: { url: track.radio.url, protocol: track.radio.hls ? 'hls' : 'progressive', mime: 'audio/mpeg', snipped: false } }
      : track.local
        ? { ok: true, status: 200, data: { url: `heddify-local://track/${track.local.key}`, protocol: 'progressive', mime: 'audio/mpeg', snipped: false } }
        : await window.sc.resolveStream(streamRequest(track))
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
    if (this.audio === this.main) this.ensureGraph()
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

  /** The stream broke (network or media error): bring it back where it was, or give up (see player/recovery.ts). */
  private async recover(): Promise<void> {
    const track = this.track
    let stream = this.stream
    if (!track || !stream || this.resolving) return
    const how = recovery(track, {
      tries: this.recoveries,
      final: isOgg(stream),
      played: this.startedFor === this.loadId,
      cors: this.audio === this.main && this.main.crossOrigin !== null
    })
    if (how === 'fail') {
      this.ev?.error(tx("Не удалось воспроизвести трек"))
      return
    }
    this.recoveries++
    const id = this.loadId
    // a live station comes back at "now", anything else where it broke
    const position = track.radio ? 0 : this.audio.currentTime
    const resume = this.wantPlay || !this.audio.paused
    this.ev?.state({ loading: true })

    if (how === 'fresh') {
      this.resolving = true
      // fresh: skip (and drop) a cached copy that failed, and for Audius ask another node
      const res = await window.sc.resolveStream({ ...streamRequest(track), fresh: true })
      if (id !== this.loadId) return
      this.resolving = false
      if (!res.ok) {
        this.ev?.error(res.error)
        return
      }
      stream = res.data
    }
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
    if (how === 'bare') {
      this.main.pause()
      this.main.removeAttribute('src')
      this.main.load()
      this.audio = this.bare
    }
    this.stream = stream
    if (stream.protocol === 'hls') await loadHls()
    if (id !== this.loadId) return
    this.attach(stream, position)
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
    this.syncCors()
    if (this.graph) this.connectGraph()
  }

  /** "Подсветка баса" on or off; like leveling it applies from the next track (Web Audio needs CORS). */
  setBassGlow(strength: number): void {
    const was = this.glow > 0
    this.glow = Math.max(0, Math.min(1, strength))
    this.syncCors()
    // the track that is playing has no analyser yet: it loads again from where it is, now with CORS
    const t = this.track
    if (this.glow > 0 && !was && !this.graph && this.stream && t && !t.radio && !t.local && !isOgg(this.stream)) void this.recover()
  }

  /** The glow strength the user set, 0..1 (0 = off). */
  glowStrength(): number {
    return this.glow
  }

  /** Whether the smooth transition is on. */
  fadeOn(): boolean {
    return this.fade
  }

  /** The bass (kick, sub) right now, 0..1; 0 while the effect is off or nothing plays through Web Audio. */
  bass(): number {
    const a = this.graph?.analyser
    if (!a || this.glow === 0 || this.audio !== this.main) return 0
    if (this.freq.length !== a.frequencyBinCount) this.freq = new Float32Array(a.frequencyBinCount)
    a.getFloatFrequencyData(this.freq)
    // the band 25–200 Hz (lib/bass.ts): its mean level goes to the pure step that makes the glow
    const { lo, hi } = bassBinRange(a.context.sampleRate, a.fftSize)
    this.bassState = stepBass(this.bassState, bassDb(this.freq, lo, hi))
    return this.bassState.level * this.glow
  }

  /**
   * The element must load with CORS while Web Audio is in its path. Once the graph exists it
   * stays in the path for good, so the CORS mode stays too: a stream without CORS then fails
   * loudly instead of playing silence (a radio station then falls back to `bare`, which never
   * uses CORS).
   */
  private syncCors(): void {
    this.main.crossOrigin = this.leveling || this.glow > 0 || this.graph ? 'anonymous' : null
  }

  private ensureGraph(): void {
    if (!this.leveling && this.glow === 0) return
    if (this.graph) return
    const ctx = new AudioContext()
    const src = ctx.createMediaElementSource(this.main)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24
    comp.knee.value = 24
    comp.ratio.value = 4
    comp.attack.value = 0.005
    comp.release.value = 0.3
    const makeup = ctx.createGain()
    makeup.gain.value = 1.35
    const analyser = ctx.createAnalyser()
    analyser.fftSize = BASS_FFT
    analyser.smoothingTimeConstant = 0.3
    this.graph = { ctx, src, comp, makeup, analyser }
    this.syncCors()
    this.connectGraph()
  }

  /** The analyser only watches: it passes the sound on unchanged, so it is always in the path. */
  private connectGraph(): void {
    const g = this.graph
    if (!g) return
    g.src.disconnect()
    g.comp.disconnect()
    g.makeup.disconnect()
    g.analyser.disconnect()
    if (this.leveling) {
      g.src.connect(g.comp)
      g.comp.connect(g.makeup)
      g.makeup.connect(g.analyser)
    } else {
      g.src.connect(g.analyser)
    }
    g.analyser.connect(g.ctx.destination)
  }

  /**
   * "Плавный переход": the sound fades in over the first seconds of a track and out over
   * its last ones, so tracks don't cut in and out. Off by default (see Settings).
   */
  setFade(on: boolean): void {
    this.fade = on
    if (on && !this.fadeTimer) this.fadeTimer = setInterval(() => this.applyVolume(), 50)
    if (!on && this.fadeTimer) {
      clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }
    this.applyVolume()
  }

  setVolume(volume: number, muted: boolean): void {
    this.level = volume
    this.muted = muted
    this.applyVolume()
  }

  private applyVolume(): void {
    // squared curve feels linear to the ear
    const gain = fadeGain(this.audio.currentTime, this.duration(), this.fade && !this.track?.radio)
    // both elements, so a station that falls back to `bare` keeps the volume
    for (const a of [this.main, this.bare]) {
      a.volume = Math.max(0, Math.min(1, this.level * this.level * gain))
      a.muted = this.muted
    }
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
