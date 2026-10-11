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
