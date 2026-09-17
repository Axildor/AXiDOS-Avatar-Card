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
 * Parse a progress sensor state string into a clamped 0-100 number.
 * Returns null for unavailable/unknown/non-numeric states so the caller can
 * hide the ring instead of showing a bogus value.
 */
export function parseProgress(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === '' || s === 'unavailable' || s === 'unknown' || s === 'none') return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
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