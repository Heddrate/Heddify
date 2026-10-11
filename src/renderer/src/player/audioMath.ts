/**
 * Pure audio maths, kept apart from the element and the Web Audio graph so it can be tested.
 */

/** "Плавный переход": how long the sound takes to fade in at a track's start and out at its end. */
export const FADE_S = 2

/**
 * Gain (0..1) at `position` of a track `duration` long. Tracks shorter than a few fades, and
 * streams with no known length (radio), are not faded.
 */
export function fadeGain(position: number, duration: number, fade: boolean): number {
  if (!fade || !Number.isFinite(duration) || duration <= FADE_S * 3) return 1
  return Math.max(0, Math.min(1, Math.min(position, duration - position) / FADE_S))
}

/** Equalizer bands: the frequency each slider controls and the filter shape that drives it. */
export const EQ_BANDS: { freq: number; type: BiquadFilterType; label: string }[] = [
  { freq: 60, type: 'lowshelf', label: '60' },
  { freq: 250, type: 'peaking', label: '250' },
  { freq: 1000, type: 'peaking', label: '1k' },
  { freq: 4000, type: 'peaking', label: '4k' },
  { freq: 12000, type: 'highshelf', label: '12k' }
]

/** Each band moves by at most this many decibels either way. */
export const EQ_RANGE_DB = 12

export function clampDb(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, Math.round(v)))
}
