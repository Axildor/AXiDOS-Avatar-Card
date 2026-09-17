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