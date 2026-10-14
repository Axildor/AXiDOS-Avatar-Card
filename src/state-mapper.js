/**
 * state-mapper.js — Pure state resolution.
 * Maps raw Home Assistant entity states onto the card's internal
 * animation states. No DOM access.
 */

/** Map a raw voice-assistant state string to an internal state. */
export function mapVoiceState(raw) {
  const s = (raw || 'idle').toLowerCase();
  if (s.includes('respond') || s.includes('speak') || s.includes('tts')) return 'responding';
  if (s.includes('listen') || s.includes('wake')) return 'listening';
  if (s.includes('process') || s.includes('think')) return 'processing';
  if (s === 'dancing') return 'dancing';
  return 'idle';
}

/**
 * Resolve the final internal state from voice + media states.
 * Media playing promotes idle to dancing.
 */
export function resolveState(voiceState, mediaState) {
  let mapped = mapVoiceState(voiceState);
  if (mapped === 'idle' && mediaState === 'playing') mapped = 'dancing';
  return mapped;
}

/** Parse a BPM entity state string, defaulting to 120. */
export function parseBpm(rawBpm) {
  const n = parseFloat(rawBpm);
  return isNaN(n) ? 120 : n;
}

/**
 * Parse the AX BPM mood entity's data into a dance-style directive.
 *
 * Source (5.7.0): the dedicated AX BPM mood entity (integration 3.3.0+).
 * hass-update.js merges its STATE (the mood label, e.g. 'party') and its
 * ATTRIBUTES (mood_scores / intensity / calmness) into one dict:
 *   mood_scores: { aggressive, party, relaxed, electronic, acoustic }
 *   mood_label:  the dominant label (e.g. 'party')
 *   intensity / calmness: 0-1 scalars
 *
 * Output (all fields always present — callers never null-check):
 *   present:     false when no usable mood attributes exist (plain BPM
 *                sensor) — every directive is then neutral, so existing
 *                users get bit-identical behavior.
 *   tierShift:   -1 | 0 | +1 — shifts the BPM-derived phrase-library tier.
 *                relaxed-dominant downshifts (chill moves at fast tempo),
 *                party/aggressive-dominant upshifts.
 *   energyBias:  additive bias for the choreography energy envelope,
 *                clamped to [-0.2, +0.2]. Relaxed pulls wild phrases out
 *                of selection; party/aggressive pull them in.
 *   lidFloor:    the dance lid-droop floor. Relaxed raises it (sleepy
 *                chill), party/aggressive lower it (wide awake).
 *
 * Dominance rule: the mood_label's own score must be the maximum of the
 * score set AND above MOOD_CONFIDENCE (0.4) — a weak or noisy
 * classification stays neutral instead of yanking the style around.
 */
export function parseMood(attrs) {
  const neutral = { present: false, tierShift: 0, energyBias: 0, lidFloor: null };
  if (!attrs || typeof attrs !== 'object') return neutral;
  const scores = attrs.mood_scores;
  if (!scores || typeof scores !== 'object') return neutral;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const aggressive = num(scores.aggressive);
  const party = num(scores.party);
  const relaxed = num(scores.relaxed);
  if (aggressive === null && party === null && relaxed === null) return neutral;

  const label = typeof attrs.mood_label === 'string' ? attrs.mood_label.toLowerCase() : '';
  const vals = [aggressive, party, relaxed].filter((v) => v !== null);
  const maxScore = vals.length ? Math.max(...vals) : 0;
  // Dominance: the labeled mood must be the top score and confident.
  const labelScore = label === 'aggressive' ? aggressive
    : label === 'party' ? party
    : label === 'relaxed' ? relaxed
    : null;
  const dominant = labelScore !== null && labelScore >= MOOD_CONFIDENCE && labelScore >= maxScore;

  let tierShift = 0;
  let energyBias = 0;
  let lidFloor = null;
  if (dominant) {
    if (label === 'relaxed') {
      tierShift = -1;
      energyBias = -0.2;
      lidFloor = MOOD_LID_RELAXED;
    } else {
      // party and aggressive both read as high-arousal: upshift + brighter.
      tierShift = 1;
      energyBias = 0.2;
      lidFloor = MOOD_LID_AWAKE;
    }
  } else {
    // Non-dominant moods still tint the energy envelope softly from the
    // raw scores (party/aggressive up, relaxed down), never enough to
    // cross the tier gate on their own.
    const p = party || 0;
    const ag = aggressive || 0;
    const re = relaxed || 0;
    energyBias = Math.max(-0.2, Math.min(0.2, (p * 0.6 + ag * 0.4 - re) * 0.3));
  }
  return { present: true, tierShift, energyBias, lidFloor };
}

/** Confidence threshold for a mood label to steer the style. */
export const MOOD_CONFIDENCE = 0.4;

/**
 * Compact change-detection signature for the mood entity's data.
 * The firehose gate compares this string instead of the raw attributes
 * object (HA replaces the attributes object on every sensor update, so a
 * raw comparison would gate-bust on every delivery). Scores are rounded to
 * 2 decimals — sub-0.01 analyzer churn between updates does not restart or
 * retune the dance.
 */
export function moodSignature(attrs) {
  if (!attrs || typeof attrs !== 'object' || !attrs.mood_scores || typeof attrs.mood_scores !== 'object') return '';
  const s = attrs.mood_scores;
  const r2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : '-');
  return [
    attrs.mood_label || '',
    r2(s.aggressive), r2(s.party), r2(s.relaxed), r2(s.electronic), r2(s.acoustic),
  ].join('|');
}
/** Lid-droop floors: relaxed keeps a sleepy droop, high-arousal stays open. */
export const MOOD_LID_RELAXED = 0.3;
export const MOOD_LID_AWAKE = 0.05;

/**
 * Parse a progress sensor state string and normalize it to the ring's 0-100
 * scale using the configured bounds (progress_min / progress_max).
 *
 * The raw sensor value v is mapped as: pct = (v − min) / (max − min) × 100,
 * clamped to [0, 100]. With the default bounds (0, 100) this is the legacy
 * identity behavior. Values below min read as 0%, above max as 100%.
 *
 * Returns null for unavailable/unknown/non-numeric states so the caller can
 * hide the ring instead of showing a bogus value.
 */
export function parseProgress(raw, min = 0, max = 100) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === '' || s === 'unavailable' || s === 'unknown' || s === 'none') return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : 100;
  if (hi <= lo) return Math.min(100, Math.max(0, n));
  return Math.min(100, Math.max(0, ((n - lo) / (hi - lo)) * 100));
}

/**
 * Progress ring stroke color.
 *  - Static mode: the idle pupil shade (#ffcc00) regardless of percentage.
 *  - Dynamic mode: HSL hue interpolation across the 0-100 scale. Default
 *    direction is green (hue 120) at 0% → red (hue 0) at 100%; hue 60
 *    naturally passes through yellow mid-scale. Inverted flips the
 *    direction (red at 0% → green at 100%).
 */
export function progressColor(pct, dynamic, inverted) {
  if (!dynamic) return '#ffcc00';
  const t = Math.min(100, Math.max(0, pct)) / 100;
  const hue = inverted ? t * 120 : 120 - t * 120;
  return `hsl(${hue.toFixed(1)}, 100%, 45%)`;
}

/**
 * Compute the stroke-dasharray for a symmetric VERTICAL (bottom-up) fill of
 * the #progress-ring stadium path (pathLength=100).
 *
 * The path starts at BOTTOM-CENTER and runs clockwise: bottom-left cap arc
 * (quarter circle, r=33) → left straight (95.5px) → top-left cap arc →
 * top-right cap arc → right straight → bottom-right cap arc. A 3-value dash
 * pattern [L, 100−2L, L] lights two dashes that BOTH start at bottom-center:
 * dash 1 climbs the left side, dash 2 (after the single gap) climbs the right
 * side — so both sides rise symmetrically from the bottom, and the unlit gap
 * sits at the TOP. At 25% both sides stand 25% up from the bottom; at 50%
 * both stand at half height; at 100% the dashes meet at top-center (gap 0)
 * and the whole ring is lit.
 *
 * (The 5.4.1 release used a 4-value pattern [L, 50−L, L, 50−L], which put
 * the second dash's start at top-center — the right side filled DOWN from
 * the top instead of up from the bottom. The 3-value pattern fixes this.)
 *
 * The dash length is computed piecewise in real px (cap arcs r=33, straight
 * sides 95.5px, socket height 161.5px) then normalized by the true perimeter
 * (398.35px → pathLength 100), so the lit HEIGHT is linear in pct even
 * though the caps are curved.
 */
export function verticalProgressDash(pct) {
  const R = 33;                    // cap radius (px)
  const SIDE = 95.5;               // straight side length (px)
  const H = 161.5;                 // total socket height (px)
  const CAP = (Math.PI / 2) * R;   // quarter-cap arc length ≈ 51.84
  const PERIM = 4 * CAP + 2 * SIDE; // ≈ 398.35
  const t = Math.min(100, Math.max(0, pct)) / 100;
  if (t <= 0) return '0 100';
  const d = t * H;                 // rise from the bottom (px)
  let lit;
  if (d <= R) {
    // Inside the bottom cap: rise d = R(1 - cos α) → arc = R·α
    lit = R * Math.acos(1 - d / R);
  } else if (d <= R + SIDE) {
    // Inside the straight side
    lit = CAP + (d - R);
  } else {
    // Inside the top cap: rise past the line = R·sin α → arc = R·α
    lit = CAP + SIDE + R * Math.asin((d - R - SIDE) / R);
  }
  const L = (lit / PERIM) * 100;   // normalize to pathLength=100
  const G = 100 - 2 * L;           // single gap, always at the TOP
  return `${L.toFixed(2)} ${G.toFixed(2)} ${L.toFixed(2)}`;
}