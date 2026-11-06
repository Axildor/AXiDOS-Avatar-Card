/**
 * motion.js — Motion intensity policy + flash-safety budget (5.8.0).
 *
 * PURE: no DOM, no media queries. Callers resolve `prefers-reduced-motion`
 * themselves (axidos-card.js owns the matchMedia listener) and pass the
 * boolean in, so this module stays unit-testable and usable from the verify
 * suites without a browser.
 *
 * The three modes are deliberately a LADDER OF REMOVAL, not a speed knob:
 *
 *   full    — every channel runs (the 5.7.x behaviour).
 *   reduced — work is REMOVED: no stepped glitch, no red/white optic strobe,
 *             no conduit compression. Motion that remains is slow and
 *             low-amplitude. This is what `prefers-reduced-motion: reduce`
 *             maps to, and it must never be MORE expensive than full.
 *   off     — the behavior engines never start at all. One static frame is
 *             composed per state and nothing schedules further work.
 *
 * There is deliberately no "intense" mode: this character does not get
 * louder, she gets stiller.
 */

export const MOTION_FULL = 'full';
export const MOTION_REDUCED = 'reduced';
export const MOTION_OFF = 'off';

/** Coerce a raw config value into a valid motion_intensity. */
export function sanitizeMotionIntensity(value) {
  if (value === MOTION_REDUCED || value === MOTION_OFF) return value;
  return MOTION_FULL;
}

/**
 * Resolve the effective mode for this delivery.
 *
 * The user's explicit `off` always wins (a user asking for stillness is not
 * overridden by an OS preference). Otherwise the OS preference can only ever
 * DOWNGRADE: `prefers-reduced-motion: reduce` + config `full` → `reduced`.
 * An OS preference can never upgrade `reduced` back to `full`.
 *
 * @param {string} configIntensity - motion_intensity from config
 * @param {boolean} prefersReduced - matchMedia('(prefers-reduced-motion: reduce)').matches
 */
export function resolveMotionMode(configIntensity, prefersReduced) {
  const configured = sanitizeMotionIntensity(configIntensity);
  if (configured === MOTION_OFF) return MOTION_OFF;
  if (configured === MOTION_REDUCED || prefersReduced === true) return MOTION_REDUCED;
  return MOTION_FULL;
}

/**
 * Channel gates. Every gate returns TRUE when the channel may run, so the
 * call sites read as `if (allowsStrobe(mode)) ...` and a removed channel is
 * a removed branch — not a zero-amplitude write.
 */

/** The stepped mechanical glitch (idle) — full only. */
export function allowsGlitch(mode) { return mode === MOTION_FULL; }

/** The tier-3 red/white optic strobe — full only (reduced suppresses it). */
export function allowsStrobe(mode) { return mode === MOTION_FULL; }

/** The conduit compression on the dance beat — full only. */
export function allowsConduit(mode) { return mode === MOTION_FULL; }

/** The endless ambient sway keyframes — full only. */
export function allowsSway(mode) { return mode === MOTION_FULL; }

/** Any behavior engine at all (idle scheduler, lid/aperture loop, dance). */
export function allowsBehaviorEngine(mode) { return mode !== MOTION_OFF; }

/** Aperture hold multiplier: reduced stretches holds, so it moves less often. */
export function apertureHoldScale(mode) {
  return mode === MOTION_REDUCED ? 1.8 : 1;
}

// ---- Flash safety (photosensitivity) ----

/**
 * Minimum seconds between optic colour TOGGLES under `flash_safe`.
 * 0.5 s → 2 Hz. WCAG 2.3.1 allows up to 3 flashes/second for small areas,
 * but this optic is large and bright against a dark faceplate, so the card
 * ships with the stricter 2 Hz budget on by default.
 */
export const MIN_STROBE_STEP_SEC = 0.5;

/**
 * How many BEATS must pass between strobe colour toggles.
 *
 * The 5.7.x strobe toggled red↔white on EVERY beat: at 170 BPM the beat is
 * 0.353 s, i.e. a 2.83 Hz toggle rate — above the 2 Hz budget the plan set.
 * The fix is to hold each colour for an integer number of beats so the
 * toggle interval is always >= MIN_STROBE_STEP_SEC.
 *
 *   flash_safe OFF  → divisor 1 (legacy: every beat, user's choice)
 *   flash_safe ON   → divisor = ceil(0.5 / beatSec), minimum 1
 *
 * At 200 BPM (0.30 s beat) → 2 beats = 0.60 s. At 60 BPM (1.0 s) → 1 beat.
 * Every tier and every sanitized BPM therefore satisfies >= 0.5 s.
 *
 * @param {number} beatSec - seconds per beat
 * @param {boolean} flashSafe - config.flash_safe (default true)
 * @returns {number} integer beats between toggles (>= 1)
 */
export function strobeStepBeats(beatSec, flashSafe) {
  if (!(typeof beatSec === 'number') || !Number.isFinite(beatSec) || beatSec <= 0) return 2;
  if (flashSafe === false) return 1;
  return Math.max(1, Math.ceil(MIN_STROBE_STEP_SEC / beatSec));
}

/**
 * The strobe colour for a given beat under the flash budget.
 * Pure: the dance loop calls this once per beat and only writes on change.
 *
 * @param {number} dancePhase global beat counter
 * @param {number} beatSec
 * @param {boolean} flashSafe
 * @returns {'#ff0000'|'#ffffff'}
 */
export function strobeColorAt(dancePhase, beatSec, flashSafe) {
  const step = strobeStepBeats(beatSec, flashSafe);
  const slot = Math.floor(dancePhase / step);
  return (slot % 2 === 0) ? '#ffffff' : '#ff0000';
}
