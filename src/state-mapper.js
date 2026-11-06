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
 * ATTRIBUTES (mood_scores) into one dict:
 *   mood_scores: { aggressive, party, relaxed, electronic, acoustic }
 *   mood_label:  the dominant label (e.g. 'party')
 *
 * intensity / calmness are published by the integration but deliberately
 * NOT consumed here: they are derived (intensity = mean(aggressive, party,
 * electronic), calmness = mean(relaxed, acoustic)), so reading them would
 * double-count the same signals the five heads already carry. The card
 * re-derives its own directives from the heads to keep the mapping
 * explicit and tunable.
 *
 * Output (all fields always present — callers never null-check):
 *   present:     false when no usable mood attributes exist (plain BPM
 *                sensor) — every directive is then neutral, so existing
 *                users get bit-identical behavior.
 *   tierShift:   -1 | 0 | +1 — shifts the BPM-derived phrase-library tier.
 *                ALL FIVE heads steer: relaxed/acoustic-dominant
 *                downshifts (chill moves at fast tempo),
 *                aggressive/party/electronic-dominant upshifts.
 *   energyBias:  additive bias for the choreography energy envelope,
 *                clamped to [-0.2, +0.2]. Calm heads pull wild phrases out
 *                of selection; high-arousal heads pull them in.
 *   lidFloor:    the dance lid-droop floor. Calm heads raise it (sleepy
 *                droop), high-arousal heads LOWER it below the BPM floor
 *                (wide awake) — see resolveLidFloor in behaviors/dance.js.
 *
 * Five-head mapping (5.7.2). The two extra heads steer at reduced weight
 * because the integration's own arithmetic treats them as secondary
 * signals: `electronic` is an intensity numerator but a weak party proxy,
 * and `acoustic` is a calmness numerator but a weaker one than `relaxed`.
 * Weights scale energyBias AND scale how far lidFloor moves.
 *
 *   head         family        weight  tierShift  energyBias  lidFloor
 *   aggressive   high-arousal  1.0     +1          +0.20       0.05
 *   party        high-arousal  1.0     +1          +0.18       0.06
 *   electronic   high-arousal  0.6     +1          +0.12       0.07
 *   relaxed      calm          1.0     -1          -0.20       0.30
 *   acoustic     calm          0.6     -1          -0.12       0.22
 *
 * Every head gets a DISTINCT (energyBias, lidFloor) pair on purpose: two
 * heads resolving to the same directive would mean `set_mood` could change
 * the sensor state without changing anything on screen — the exact defect
 * this release set out to remove. Within the high-arousal family the order
 * is severity (aggressive > party > electronic); within the calm family it
 * is droop (relaxed > acoustic).
 *
 * Dominance rule: the mood_label's own score must be the maximum of the
 * COMPLETE five-head set AND above MOOD_CONFIDENCE (0.4) — a weak or noisy
 * classification stays neutral instead of yanking the style around. The
 * set is complete over all five heads because the integration's mood_label
 * is an argmax over all five (`_mood_attrs_from_payload`), so a label like
 * 'electronic' is a legitimate, expected input — reading only three heads
 * made two of the five `set_mood` override options inert.
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
  const electronic = num(scores.electronic);
  const acoustic = num(scores.acoustic);
  // No head carries a number → nothing to steer with.
  if (aggressive === null && party === null && relaxed === null
    && electronic === null && acoustic === null) return neutral;

  const label = typeof attrs.mood_label === 'string' ? attrs.mood_label.toLowerCase() : '';
  // Dominance is judged over the COMPLETE five-head set (mirrors the
  // integration's argmax domain). null heads simply do not compete.
  const vals = [aggressive, party, relaxed, electronic, acoustic].filter((v) => v !== null);
  const maxScore = vals.length ? Math.max(...vals) : 0;
  const labelScore = MOOD_HEAD_BY_LABEL[label] !== undefined
    ? num(scores[label])
    : null;
  const dominant = labelScore !== null && labelScore >= MOOD_CONFIDENCE && labelScore >= maxScore;

  let tierShift = 0;
  let energyBias = 0;
  let lidFloor = null;
  if (dominant && MOOD_HEAD_BY_LABEL[label] !== undefined) {
    const head = MOOD_HEAD_BY_LABEL[label];
    tierShift = head.tierShift;
    energyBias = head.energyBias;
    lidFloor = head.lidFloor;
  } else {
    // Non-dominant moods still tint the energy envelope softly from the
    // raw scores, never enough to cross the tier gate on their own. All
    // five heads participate: high-arousal heads push up, calm heads pull
    // down, each at its family weight.
    const p = party || 0;
    const ag = aggressive || 0;
    const el = electronic || 0;
    const re = relaxed || 0;
    const ac = acoustic || 0;
    energyBias = Math.max(-0.2, Math.min(0.2,
      (p * 0.6 + ag * 0.4 + el * 0.25 - re - ac * 0.5) * 0.3));
  }
  return { present: true, tierShift, energyBias, lidFloor };
}

/** Confidence threshold for a mood label to steer the style. */
export const MOOD_CONFIDENCE = 0.4;

/**
 * Lid-droop floors per mood family (5.7.2).
 *
 * These are ABSOLUTE floors: when a mood is present its floor REPLACES the
 * BPM-only floor instead of being maxed with it. That is what makes the
 * high-arousal branch meaningful — the old `Math.max(bpmFloor, moodFloor)`
 * could never let 0.05 beat 0.15/0.08, so "wide awake" was dead code.
 *
 * Calm heads raise the floor (heavy droop, sleepy chill); high-arousal
 * heads lower it (wide awake, more of the phrase's own lid attitude
 * survives). Two weights per family: the secondary heads (electronic,
 * acoustic) move the floor only part-way toward the primary head's value,
 * mirroring their reduced energyBias weight.
 */
export const MOOD_LID_AWAKE = 0.05;
/** Party: celebratory but less severe than aggressive. */
export const MOOD_LID_PARTY = 0.06;
/**
 * Secondary high-arousal head: the least awake of the high family, but it
 * MUST stay below BOTH BPM floors (0.15 at <125 BPM, 0.08 at >=125 BPM) or
 * the head stops clearing the droop at club tempos and starts adding to it
 * — an inversion verified by verify_mood_style check 10h.
 */
export const MOOD_LID_ELECTRONIC = 0.07;
/** Secondary calm head: between the awake and relaxed floors. */
export const MOOD_LID_ACOUSTIC = 0.22;
export const MOOD_LID_RELAXED = 0.3;

/**
 * Per-head dance-style directive table (5.7.2 — all five heads steer).
 *
 * The integration's mood_label is an argmax over all FIVE heads, so every
 * head is a legitimate label. Previously only three were mapped, which
 * made `electronic` and `acoustic` (two of the five `set_mood` override
 * choices) change the sensor state without changing anything visual.
 *
 * Weights: the two secondary heads steer at 0.6 because the integration's
 * own published arithmetic treats them as secondary — `electronic` is an
 * intensity numerator but a weak party proxy, `acoustic` a calmness
 * numerator but weaker than `relaxed`.
 *
 * Kept as data, not branches, so the verify suite can assert every head is
 * mapped and no two heads share a directive tuple.
 */
export const MOOD_HEAD_BY_LABEL = {
  // High-arousal family, ordered by severity: aggressive is the most
  // extreme descriptor, party the celebratory one, electronic the weakest
  // (it is an intensity numerator, not a mood-strength claim).
  aggressive: { family: 'high', weight: 1.0, tierShift: 1, energyBias: 0.2, lidFloor: MOOD_LID_AWAKE },
  party: { family: 'high', weight: 1.0, tierShift: 1, energyBias: 0.18, lidFloor: MOOD_LID_PARTY },
  electronic: { family: 'high', weight: 0.6, tierShift: 1, energyBias: 0.12, lidFloor: MOOD_LID_ELECTRONIC },
  // Calm family, ordered by droop: relaxed is the primary calm numerator,
  // acoustic the weaker one.
  relaxed: { family: 'calm', weight: 1.0, tierShift: -1, energyBias: -0.2, lidFloor: MOOD_LID_RELAXED },
  acoustic: { family: 'calm', weight: 0.6, tierShift: -1, energyBias: -0.12, lidFloor: MOOD_LID_ACOUSTIC },
};

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