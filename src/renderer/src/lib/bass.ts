/**
 * The bass level that drives the glow around the cover, as pure steps: one call per frame
 * with the mean level (dB) of the bass bins. A kick jumps well above the track's own normal
 * bass and the level falls back after it; steady bass gives a dim glow.
 */

export interface BassState {
  /** Slow average of the bass in dB: the track's normal level. */
  avg: number
  /** Output, 0..1. */
  level: number
}

export const initialBass = (): BassState => ({ avg: NaN, level: 0 })

/** Analysers report silence as -Infinity; that counts as very quiet, not as a number. */
const FLOOR_DB = -100

export function stepBass(s: BassState, db: number): BassState {
  // silence says nothing about the track's normal bass: it only lets the glow fade out
  if (!Number.isFinite(db)) return { avg: s.avg, level: s.level * 0.9 }
  const x = Math.max(FLOOR_DB, db)
  const avg = Number.isNaN(s.avg) ? x : s.avg + (x - s.avg) * 0.02
  // 8 dB above the normal bass is a full kick; steady bass is the normal, so it gives no glow
  const target = Math.min(1, Math.max(0, (x - avg) / 8))
  // fast rise on a kick, a short release after it: in quiet parts the glow is gone within a moment
  const level = target > s.level ? s.level + (target - s.level) * 0.7 : s.level + (target - s.level) * 0.15
  return { avg, level }
}

/** The bass band the glow follows: from the sub (kick body) up to 200 Hz. */
export const BASS_LOW_HZ = 25
export const BASS_HIGH_HZ = 200
/** Analyser window: 4096 points, about 11.7 Hz per bin at 48 kHz, enough to separate 25 Hz from 50 Hz. */
export const BASS_FFT = 4096

/** The analyser bins that cover the bass band (inclusive), for a given sample rate and window. */
export function bassBinRange(sampleRate: number, fftSize: number = BASS_FFT): { lo: number; hi: number } {
  const binHz = sampleRate / fftSize
  const lo = Math.max(1, Math.ceil(BASS_LOW_HZ / binHz))
  const hi = Math.max(lo, Math.min(fftSize / 2 - 1, Math.floor(BASS_HIGH_HZ / binHz)))
  return { lo, hi }
}

/**
 * The level of the bass band in dB: the mean power of the bins lo..hi, converted back to dB.
 * Averaging power (not dB) keeps one quiet bin from pulling the whole band down.
 */
export function bassDb(freqDb: ArrayLike<number>, lo: number, hi: number): number {
  let power = 0
  let n = 0
  for (let i = lo; i <= hi && i < freqDb.length; i++) {
    const db = Number.isFinite(freqDb[i]) ? Math.max(-120, freqDb[i]) : -120
    power += 10 ** (db / 10)
    n++
  }
  if (!n || power <= 0) return -120
  return Math.max(-120, 10 * Math.log10(power / n))
}
