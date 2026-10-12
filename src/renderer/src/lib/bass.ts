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
