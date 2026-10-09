/// <reference lib="dom" />
/**
 * Preload of the hidden music.yandex.ru engine page. Its only job: give our volume slider
 * a handle on the page's sound before the site's own scripts run.
 *
 * Yandex plays through Web Audio, so everything the page connects to the speakers is
 * routed through one gain node per AudioContext; plain <audio>/<video> playback gets the
 * same level on the element. The app sets the level with `window.__scVolume(level)`.
 */
import { contextBridge } from 'electron'

function install(): void {
  type Ctx = BaseAudioContext & { __scGain?: GainNode }
  type Media = HTMLMediaElement & { __scRouted?: boolean; __scPageVolume?: number }
  const w = window as unknown as { __scVolume?: (level: number) => void }
  if (w.__scVolume) return

  let level = 1
  const gains: GainNode[] = []
  const media = new Set<Media>()

  const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown
  const master = (ctx: Ctx): GainNode => {
    if (!ctx.__scGain) {
      const g = ctx.createGain()
      g.gain.value = level
      connect.call(g, ctx.destination)
      ctx.__scGain = g
      gains.push(g)
    }
    return ctx.__scGain
  }
  AudioNode.prototype.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
    if (dest instanceof AudioDestinationNode && this !== (dest.context as Ctx).__scGain) {
      return connect.call(this, master(dest.context as Ctx), ...rest)
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
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    applyTo(this as Media)
    return play.call(this)
  }

  w.__scVolume = (next: number) => {
    level = Math.max(0, Math.min(1, Number(next) || 0))
    for (const g of gains) g.gain.value = level
    document.querySelectorAll('audio, video').forEach((el) => media.add(el as Media))
    media.forEach(applyTo)
  }
}

contextBridge.executeInMainWorld({ func: install })
