/// <reference lib="dom" />
/**
 * Preload of the hidden engine pages, music.yandex.ru and vk.com. Its only job: give our
 * volume slider a handle on the page's sound before the site's own scripts run.
 *
 * Yandex plays through Web Audio, so everything the page connects to the speakers is
 * routed through one gain node per AudioContext; plain <audio>/<video> playback gets the
 * same level on the element. The app sets the level with `window.__scVolume(level)`.
 */
import { contextBridge } from 'electron'
import { BASS_FFT, bassBinRange, bassDb } from '../renderer/src/lib/bass'

/** The bass math from lib/bass, handed over as arguments (see `install`). */
interface BassMath {
  fft: number
  range: typeof bassBinRange
  db: typeof bassDb
}

/**
 * Runs in the page's own world from its source text alone: nothing from this module
 * (imports, constants) exists there, whatever it needs comes in as an argument.
 * Using an import here broke every connect to the speakers, the page played in silence.
 */
function install(bass: BassMath): void {
  type Ctx = BaseAudioContext & { __scGain?: GainNode }
  type Media = HTMLMediaElement & { __scRouted?: boolean; __scPageVolume?: number }
  const w = window as unknown as {
    __scVolume?: (level: number) => void
    __scAllowPlay?: (ms: number) => void
    __scBass?: () => { db: number; pos: number; dur: number }
    __scDiag?: () => unknown
  }
  if (w.__scVolume) return

  // silent until the app sets the level: a page that loads again must not start at full volume
  let level = 0
  const gains: GainNode[] = []
  // listeners on the page's output: they only measure, nothing is played through them
  const analysers: { node: AnalyserNode; buf: Float32Array<ArrayBuffer> }[] = []
  const media = new Set<Media>()

  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown
  const master = (ctx: Ctx): GainNode => {
    if (!ctx.__scGain) {
      const g = ctx.createGain()
      g.gain.value = level
      connect.call(g, ctx.destination)
      const node = ctx.createAnalyser()
      node.fftSize = bass.fft
      node.smoothingTimeConstant = 0
      connect.call(g, node)
      analysers.push({ node, buf: new Float32Array(new ArrayBuffer(node.frequencyBinCount * 4)) })
      ctx.__scGain = g
      gains.push(g)
    }
    return ctx.__scGain
  }
  AudioNode.prototype.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
    if (dest instanceof AudioDestinationNode && this !== (dest.context as Ctx).__scGain) {
      let via: GainNode | null = null
      try {
        via = master(dest.context as Ctx)
      } catch {
        // our volume must never cost the page its sound: straight to the speakers then
      }
      if (via) return connect.call(this, via, ...rest)
    }
    return connect.call(this, dest, ...rest)
  } as typeof AudioNode.prototype.connect

  // An element captured by Web Audio is already covered by the gain node.
  const capture = AudioContext.prototype.createMediaElementSource
  AudioContext.prototype.createMediaElementSource = function (this: AudioContext, el: HTMLMediaElement) {
    ;(el as Media).__scRouted = true
    applyTo(el as Media)
    return capture.call(this, el)
  }

  // A context the page made before any click stays suspended until one: our requests count as one.
  const resume = (): void => {
    for (const g of gains) {
      const ctx = g.context as AudioContext
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') void ctx.resume().catch(() => undefined)
    }
  }

  // The page keeps its own idea of the element volume; what actually sounds is ours.
  const vol = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume')!
  const applyTo = (el: Media): void => {
    media.add(el)
    vol.set!.call(el, el.__scRouted ? 1 : level * (el.__scPageVolume ?? 1))
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    configurable: true,
    enumerable: vol.enumerable,
    get(this: Media) {
      return this.__scPageVolume ?? (vol.get!.call(this) as number)
    },
    set(this: Media, v: number) {
      this.__scPageVolume = Math.max(0, Math.min(1, Number(v) || 0))
      applyTo(this)
    }
  })
  // The page must not start audio on its own (after a reload or its own queue): only while
  // the app has just asked for playback (`__scAllowPlay`, see lib/yandex.ts).
  let allowUntil = 0
  w.__scAllowPlay = (ms: number) => {
    allowUntil = Math.max(allowUntil, Date.now() + ms)
    resume()
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    applyTo(this as Media)
    if (Date.now() > allowUntil) return Promise.reject(new DOMException('Playback was not requested by the app', 'NotAllowedError'))
    return play.call(this)
  }

  w.__scVolume = (next: number) => {
    level = Math.max(0, Math.min(1, Number(next) || 0))
    for (const g of gains) g.gain.value = level
    document.querySelectorAll('audio, video').forEach((el) => media.add(el as Media))
    media.forEach(applyTo)
    resume()
  }

  // for the app's log when a track the page calls playing makes no sound: where the sound stops
  w.__scDiag = () => ({
    level: +level.toFixed(3),
    contexts: gains.map((g) => `${g.context.state}:${g.gain.value.toFixed(2)}`),
    media: [...media].map((m) => ({
      paused: m.paused,
      muted: m.muted,
      volume: +(vol.get!.call(m) as number).toFixed(2),
      routed: !!m.__scRouted,
      ready: m.readyState,
      error: m.error?.code ?? 0,
      src: (m.currentSrc || '').split(':')[0]
    })),
    allowMs: Math.max(0, allowUntil - Date.now()),
    visibility: document.visibilityState
  })

  // what the app reads about the page's sound, about 20 times a second: the bass in dB (mean of
  // the bass bins, the loudest context wins; a floor when silent), and where the playing element is
  w.__scBass = () => {
    let db = -Infinity
    for (const a of analysers) {
      a.node.getFloatFrequencyData(a.buf)
      const { lo, hi } = bass.range(a.node.context.sampleRate, a.node.fftSize)
      db = Math.max(db, bass.db(a.buf, lo, hi))
    }
    const el = [...media].find((m) => !m.paused) ?? null
    return {
      db: Number.isFinite(db) ? db : -120,
      pos: el ? el.currentTime : 0,
      dur: el && Number.isFinite(el.duration) ? el.duration : 0
    }
  }
}

contextBridge.executeInMainWorld({ func: install, args: [{ fft: BASS_FFT, range: bassBinRange, db: bassDb } satisfies BassMath] })
