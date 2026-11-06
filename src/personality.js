/**
 * personality.js — ONE servo-aggression mapping shared by every behavior
 * engine (5.8.0), so the idle posture can never contradict the dance's
 * personality.
 *
 * Before 5.8.0 the mood directive (state-mapper.parseMood) reached the dance
 * engine only. A relaxed track therefore danced chill moves while the idle
 * behaviors kept snapping the head around at whatever amplitude happened to
 * be hardcoded — two different characters on the same card.
 *
 * The tables below are keyed by the SAME mood data the dance consumes. The
 * family is derived from the directive the dance already acts on (tierShift,
 * then energyBias sign), never from a second, parallel mood model: adding a
 * competing mapping would let one engine call a track "calm" while the other
 * called it "energetic".
 *
 * Vocabulary is mechanical throughout — aggression = how hard the servo
 * drives, not how excited she is. There is no "happy" profile.
 */

/**
 * @typedef {Object} ServoProfile
 * @property {number} aggression   0-1: fraction of the nominal amplitude a
 *                                 servo uses (0.25 = barely-driven, 1 = full).
 * @property {number} apertureBias additive lid/aperture offset. Positive =
 *                                 resting droop (calm), negative = open and
 *                                 alert (high-arousal).
 * @property {number} paceScale    multiplier on hold durations (calm holds
 *                                 longer, high-arousal cycles faster).
 * @property {number} holdScale    multiplier on behavior dwell time.
 */

/** The neutral profile: today's behaviour, bit-identically. */
export const SERVO_NEUTRAL = Object.freeze({
  family: 'neutral', aggression: 0.5, apertureBias: 0, paceScale: 1.0, holdScale: 1.0,
});

/** High-arousal (aggressive / party / electronic): short, hard, precise. */
export const SERVO_HIGH = Object.freeze({
  family: 'high', aggression: 1.0, apertureBias: -0.06, paceScale: 0.82, holdScale: 0.88,
});

/** Calm (relaxed / acoustic): slow, barely-driven, heavy resting droop. */
export const SERVO_CALM = Object.freeze({
  family: 'calm', aggression: 0.25, apertureBias: 0.1, paceScale: 1.25, holdScale: 1.4,
});

/** The complete table, exported so the verify suite can assert coverage. */
export const SERVO_PROFILES = Object.freeze({
  neutral: SERVO_NEUTRAL,
  high: SERVO_HIGH,
  calm: SERVO_CALM,
});

/**
 * Map a mood directive (parseMood output) onto a servo profile.
 *
 * The mood argument is optional and absent-safe: no mood (or a non-present
 * directive) returns the neutral profile, which is bit-identical to the
 * pre-5.8.0 idle amplitudes. That keeps plain-BPM users unchanged.
 *
 * @param {{present:boolean, tierShift:number, energyBias:number}|null} mood
 * @returns {ServoProfile}
 */
export function servoPersonality(mood) {
  if (!mood || mood.present !== true) return SERVO_NEUTRAL;
  if (mood.tierShift > 0) return SERVO_HIGH;
  if (mood.tierShift < 0) return SERVO_CALM;
  // A non-dominant mood that only tints the energy envelope (tierShift 0):
  // follow the sign of that tint, and stay neutral at exactly zero.
  if (typeof mood.energyBias === 'number' && mood.energyBias > 0.04) return SERVO_HIGH;
  if (typeof mood.energyBias === 'number' && mood.energyBias < -0.04) return SERVO_CALM;
  return SERVO_NEUTRAL;
}

/**
 * Scale a nominal servo amplitude by the profile's aggression.
 *
 * Sub-degree results are preserved (the station-keeping channel depends on
 * being able to ask for 0.3 degrees), so there is no floor here.
 *
 * @param {number} nominal
 * @param {ServoProfile} profile
 */
export function servoAmplitude(nominal, profile) {
  const k = profile && typeof profile.aggression === 'number' ? profile.aggression : 0.5;
  return nominal * k;
}

/**
 * Scale a nominal hold/dwell duration by the profile.
 * @param {number} ms
 * @param {ServoProfile} profile
 */
export function servoHold(ms, profile) {
  const k = profile && typeof profile.holdScale === 'number' ? profile.holdScale : 1;
  return Math.round(ms * k);
}
