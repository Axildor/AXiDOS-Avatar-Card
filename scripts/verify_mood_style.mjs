/**
 * verify_mood_style.mjs — verification of the mood-aware dance style
 * contract added in 5.6.0, updated in 5.7.0 for the AX BPM 3.3.0 mood
 * entity split.
 *
 * The AX BPM integration (3.3.0+) publishes mood on a DEDICATED mood
 * entity: its STATE is the mood label (aggressive/party/relaxed/
 * electronic/acoustic or unknown), its ATTRIBUTES carry mood_scores /
 * intensity / calmness. hass-update.js merges state + attributes into
 * the synthetic dict parseMood() consumes. The bpm_entity no longer
 * carries mood attributes — no legacy fallback exists.
 *
 * Covers:
 *   1. parseMood() contract (pure function):
 *      - the user's real payload (party 0.9457 @ 91 BPM) → tierShift +1
 *      - a relaxed-dominant payload → tierShift −1 (chill moves at tempo)
 *      - missing/empty attributes → neutral (bit-identical legacy behavior)
 *      - weak / non-dominant labels stay neutral on tier, soft on energy
 *      - energy-bias arithmetic + clamping
 *   2. effectiveTierForBpm(): shift + clamping at the 0/3 boundaries
 *   3. getEnergy(dancePhase, bias): additive bias under the existing clamp
 *   4. moodSignature(): stable rounded change-detection key
 *   5. Retune-vs-restart semantics through the REAL pipeline
 *      (applyHassUpdate): same-effective-tier mood change retunes in place
 *      (the _retuneDance closure reference survives), an effective-tier
 *      flip restarts the cycle (new closure), mood_style_enabled=false
 *      ignores mood entirely.
 *   6. Dance lid floor: relaxed raises the droop floor, party/aggressive
 *      leave the BPM-only floor in charge.
 *   7. Mood-entity source (5.7.0): label comes from the entity STATE,
 *      scores from its ATTRIBUTES; no mood entity / unknown / unavailable
 *      → neutral; mood-entity-only changes pass the firehose gate.
 */

import { applyHassUpdate } from '../src/hass-update.js';
import { parseMood, moodSignature, MOOD_CONFIDENCE, MOOD_LID_RELAXED, MOOD_LID_AWAKE } from '../src/state-mapper.js';
import { getEnergy } from '../src/behaviors/choreography.js';
import { startDanceCycle, stopDanceCycle, tierForBpm, effectiveTierForBpm } from '../src/behaviors/dance.js';

// Node has no rAF; idle.js schedules the lid loop through animator.requestRaf.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (fn) => {
    const id = setTimeout(() => fn(Date.now()), 16);
    if (typeof id.unref === 'function') id.unref();
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

let failures = 0;
let passed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('verify_mood_style — mood-aware dance style\n');

// ── Mock infrastructure (mirrors verify_state_recovery.mjs) ─────────────

function fakeEl() {
  return {
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
    },
  };
}

function mockAnimator() {
  const timers = new Map();
  const a = {
    el: {
      svg: fakeEl(), head: fakeEl(), headBop: fakeEl(), torsoSwivel: fakeEl(),
      hitbox: fakeEl(), eyeLayerIdle: fakeEl(), eyeLayerListen: fakeEl(),
      eyeLayerProcess: fakeEl(), eyeLayerRespond: fakeEl(), eyeLayerDance: fakeEl(),
      eyeHalo: fakeEl(), eyeCenter: fakeEl(), pupil: fakeEl(), eyeball: fakeEl(),
      bellows: fakeEl(), lidTop: fakeEl(), lidBot: fakeEl(), dangerRing: fakeEl(),
      progressRing: fakeEl(), ledMatrices: [fakeEl(), fakeEl()],
    },
    currentBaseLid: 0,
    baseLidCalls: [],
    _timers: timers,
    _rafs: new Map(),
    setTimeout(name, fn, delay) {
      if (timers.has(name)) clearTimeout(timers.get(name).id);
      const entry = { fn, delay };
      entry.id = setTimeout(() => { timers.delete(name); fn(); }, delay);
      if (typeof entry.id.unref === 'function') entry.id.unref();
      timers.set(name, entry);
      return entry.id;
    },
    clearTimeout(name) {
      const entry = timers.get(name);
      if (entry !== undefined) { clearTimeout(entry.id); timers.delete(name); }
    },
    requestRaf(name, fn) {
      if (a._rafs.has(name)) cancelAnimationFrame(a._rafs.get(name));
      const id = requestAnimationFrame((now) => { a._rafs.delete(name); fn(now); });
      a._rafs.set(name, id);
      return id;
    },
    cancelRaf(name) {
      const id = a._rafs.get(name);
      if (id !== undefined) { cancelAnimationFrame(id); a._rafs.delete(name); }
    },
    stopAll() {
      for (const entry of timers.values()) clearTimeout(entry.id);
      for (const id of a._rafs.values()) cancelAnimationFrame(id);
      timers.clear();
      a._rafs.clear();
    },
    setHead() {}, setBodySwivel() {}, resetBodySwivel() {},
    setLid() {},
    setBaseLid(amount) { a.baseLidCalls.push(amount); },
    setPupil() {}, setBellows() {},
    setLEDs() {}, setLedVars() {}, freezeHeadMotion() {}, resetBopLayer() {},
    // Layer-split API (5.7.0-beta.3): variant crossfades are no-ops here.
    setEyeCenterColor() {}, setEyeHaloFill() {},
  };
  return a;
}

function mockCard(config) {
  return {
    config,
    _hass: null,
    contentReady: true,
    _lastHassVoice: null,
    _lastHassMedia: null,
    _lastHassBpm: null,
    _lastHassProgress: null,
    _lastHassMood: null,
    _progressPct: null,
    _state: 'idle',
    _currentBpm: 120,
    _currentMood: null,
    _bopping: false,
    _bopSpring: null,
    animator: mockAnimator(),
    setupDOM() {},
    initAxidos() {},
  };
}

/** hass builder: mood lands on the dedicated mood entity (AX BPM 3.3.0+).
 *  moodState = the entity's state string (the label); moodAttrs = its
 *  attributes (mood_scores etc.). Pass moodState: null to omit the entity. */
function hass({ voice = 'idle', media = 'paused', bpm = '120', moodState = 'unknown', moodAttrs = null } = {}) {
  const states = {
    'assist_satellite.x': { state: voice },
    'media_player.x': { state: media },
    'sensor.bpm': { state: bpm, attributes: {} },
  };
  if (moodState !== null) {
    states['sensor.mood'] = { state: moodState, attributes: moodAttrs || {} };
  }
  return { states };
}

const BASE_CONFIG = {
  entity: 'assist_satellite.x',
  media_entity: 'media_player.x',
  bpm_entity: 'sensor.bpm',
  mood_entity: 'sensor.mood',
  respond_delay: 0,
  mood_style_enabled: true,
};

// The user's real payload (2026-10-14, "All Falls Down" @ 91.07 BPM).
const REAL_PAYLOAD = {
  mood_scores: { aggressive: 0.0091, party: 0.9457, relaxed: 0.4405, electronic: 0.1912, acoustic: 0.013 },
  mood_label: 'party',
  intensity: 0.382,
  calmness: 0.227,
};

// ── 1. parseMood contract ───────────────────────────────────────────────

console.log('1. parseMood contract');

{
  const m = parseMood(REAL_PAYLOAD);
  check('1a. real payload parses as present', m.present === true);
  check('1b. party-dominant upshifts the tier', m.tierShift === 1, `tierShift=${m.tierShift}`);
  check('1c. party energy bias is +0.2', m.energyBias === 0.2, `energyBias=${m.energyBias}`);
  check('1d. party lid floor is the awake floor', m.lidFloor === MOOD_LID_AWAKE, `lidFloor=${m.lidFloor}`);
  check('1e. party @ 91 BPM → effective tier 2 (groovy→club)',
    effectiveTierForBpm(91.07, m) === 2, `effective=${effectiveTierForBpm(91.07, m)}`);
}

{
  const relaxed = {
    mood_scores: { aggressive: 0.0091, party: 0.0457, relaxed: 0.9405, electronic: 0.1912, acoustic: 0.613 },
    mood_label: 'relaxed',
  };
  const m = parseMood(relaxed);
  check('1f. relaxed-dominant downshifts the tier', m.tierShift === -1, `tierShift=${m.tierShift}`);
  check('1g. relaxed energy bias is −0.2', m.energyBias === -0.2, `energyBias=${m.energyBias}`);
  check('1h. relaxed lid floor is the sleepy floor', m.lidFloor === MOOD_LID_RELAXED, `lidFloor=${m.lidFloor}`);
  check('1i. relaxed @ 130 BPM → effective tier 1 (club→groovy)',
    effectiveTierForBpm(130, m) === 1, `effective=${effectiveTierForBpm(130, m)}`);
}

{
  const m = parseMood(null);
  check('1j. null attributes → neutral mood', m.present === false && m.tierShift === 0 && m.energyBias === 0 && m.lidFloor === null);
  const m2 = parseMood({});
  check('1k. empty attributes → neutral mood', m2.present === false && m.tierShift === 0);
  const m3 = parseMood({ mood_label: 'party' });
  check('1l. label without scores → neutral mood', m3.present === false);
  const m4 = parseMood({ mood_scores: { electronic: 0.8, acoustic: 0.1 } });
  check('1m. scores without a steerable component → fully neutral',
    m4.present === false && m4.tierShift === 0 && m4.energyBias === 0 && m4.lidFloor === null);
}

{
  // Weak label: 'party' labeled but relaxed scores higher, and party < 0.4.
  const weak = {
    mood_scores: { aggressive: 0.1, party: 0.3, relaxed: 0.4405 },
    mood_label: 'party',
  };
  const m = parseMood(weak);
  check('1n. weak/subdominant label does NOT shift the tier', m.tierShift === 0, `tierShift=${m.tierShift}`);
  // The soft formula weighs party·0.6 + aggressive·0.4 − relaxed: with
  // relaxed 0.44 outweighing party 0.3, the tint correctly leans negative.
  check('1o. weak label still tints energy softly (relaxed-leaning here)',
    m.energyBias < 0 && m.energyBias > -0.2, `energyBias=${m.energyBias.toFixed(4)}`);
}

{
  // Label below the confidence threshold even when it IS the max.
  const lowConf = {
    mood_scores: { aggressive: 0.05, party: 0.35, relaxed: 0.2 },
    mood_label: 'party',
  };
  const m = parseMood(lowConf);
  check('1p. label below MOOD_CONFIDENCE stays tier-neutral', m.tierShift === 0, `threshold=${MOOD_CONFIDENCE}`);
  // Aggressive reads as high-arousal like party.
  const aggr = { mood_scores: { aggressive: 0.9, party: 0.1, relaxed: 0.05 }, mood_label: 'aggressive' };
  const m2 = parseMood(aggr);
  check('1q. aggressive-dominant upshifts like party', m2.tierShift === 1 && m2.energyBias === 0.2);
}

// ── 2. effectiveTierForBpm clamping ─────────────────────────────────────

console.log('2. effectiveTierForBpm clamping');
{
  const relaxed = { present: true, tierShift: -1, energyBias: -0.2, lidFloor: MOOD_LID_RELAXED };
  const party = { present: true, tierShift: 1, energyBias: 0.2, lidFloor: MOOD_LID_AWAKE };
  check('2a. tier 0 + relaxed clamps at 0', effectiveTierForBpm(70, relaxed) === 0);
  check('2b. tier 3 + party clamps at 3', effectiveTierForBpm(180, party) === 3);
  check('2c. no mood → legacy tierForBpm', effectiveTierForBpm(100, null) === tierForBpm(100));
  check('2d. neutral mood → legacy tierForBpm',
    effectiveTierForBpm(100, { present: false, tierShift: 0, energyBias: 0, lidFloor: null }) === tierForBpm(100));
  check('2e. tier boundaries unchanged without mood',
    [70, 89, 90, 110, 124, 125, 140, 159, 160, 180].every((b) => effectiveTierForBpm(b, null) === tierForBpm(b)));
}

// ── 3. getEnergy bias ───────────────────────────────────────────────────

console.log('3. getEnergy energy bias');
{
  let allShifted = true;
  let allClamped = true;
  for (let p = 0; p < 512; p++) {
    const base = getEnergy(p);
    const up = getEnergy(p, 0.2);
    const down = getEnergy(p, -0.2);
    // Bias is additive BEFORE the clamp: within the unclamped range the
    // delta is exactly the bias; at the ceiling the up-biased value pins.
    if (base < 0.9 && Math.abs((up - base) - 0.2) > 1e-9) allShifted = false;
    if (base > 0.5 && Math.abs((base - down) - 0.2) > 1e-9) allShifted = false;
    if (up > 1.1 + 1e-9 || down < 0.3 - 1e-9) allClamped = false;
  }
  check('3a. bias shifts the envelope additively', allShifted);
  check('3b. biased envelope stays inside [0.3, 1.1]', allClamped);
  check('3c. default bias is a no-op (legacy bit-identical)',
    getEnergy(123) === getEnergy(123, 0));
}

// ── 4. moodSignature ────────────────────────────────────────────────────

console.log('4. moodSignature change-detection key');
{
  check('4a. missing attributes → empty signature', moodSignature(null) === '' && moodSignature({}) === '');
  const sig1 = moodSignature(REAL_PAYLOAD);
  const sig2 = moodSignature(JSON.parse(JSON.stringify(REAL_PAYLOAD)));
  check('4b. identical payloads → identical signature', sig1 === sig2 && sig1.length > 0, sig1);
  const churned = JSON.parse(JSON.stringify(REAL_PAYLOAD));
  churned.mood_scores.party = 0.9457 + 0.004; // sub-rounding churn
  check('4c. sub-0.01 score churn does NOT change the signature', moodSignature(churned) === sig1);
  const changed = JSON.parse(JSON.stringify(REAL_PAYLOAD));
  changed.mood_label = 'relaxed';
  check('4d. label change DOES change the signature', moodSignature(changed) !== sig1);
}

// ── 5. Retune-vs-restart through the real pipeline ──────────────────────

console.log('5. retune-vs-restart semantics (applyHassUpdate)');

// Enter dancing with the real payload (party @ 91 BPM → effective tier 2).
{
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  check('5a. card is dancing', card._state === 'dancing');
  check('5b. mood cached on the card', card._currentMood && card._currentMood.tierShift === 1);
  const hook1 = card._retuneDance;
  check('5c. retune hook installed', typeof hook1 === 'function');

  // Same effective tier: party → aggressive at the same BPM. Both upshift,
  // so effective tier stays 2 → IN-PLACE retune (hook reference survives).
  const aggrAttrs = { mood_scores: { aggressive: 0.9, party: 0.1, relaxed: 0.05 } };
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'aggressive', moodAttrs: aggrAttrs }));
  check('5d. same-effective-tier mood change retunes in place',
    card._state === 'dancing' && card._retuneDance === hook1);
  check('5e. retuned mood directives applied',
    card._currentMood && card._currentMood.tierShift === 1 && card._currentMood.lidFloor === MOOD_LID_AWAKE);

  // Effective-tier flip: party → relaxed at the same BPM (2 → 0) → restart.
  const relaxedAttrs = { mood_scores: { aggressive: 0.01, party: 0.05, relaxed: 0.94 } };
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'relaxed', moodAttrs: relaxedAttrs }));
  check('5f. effective-tier flip restarts the cycle (new hook)',
    card._state === 'dancing' && typeof card._retuneDance === 'function' && card._retuneDance !== hook1);
  check('5g. restarted card carries the relaxed mood',
    card._currentMood && card._currentMood.tierShift === -1);
  stopDanceCycle(card);
}

// BPM-side tier flip with mood attached: 91 → 130 with party mood is
// effective tier 2 → 3 → restart; 91 → 110 with party stays tier 2 → retune.
{
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  const hook1 = card._retuneDance;
  applyHassUpdate(card, hass({ media: 'playing', bpm: '110', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  check('5h. same-effective-tier BPM change still retunes in place',
    card._state === 'dancing' && card._retuneDance === hook1);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '130', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  check('5i. cross-effective-tier BPM change restarts',
    card._state === 'dancing' && card._retuneDance !== hook1);
  stopDanceCycle(card);
}

// mood_style_enabled=false: mood is ignored entirely (legacy behavior).
{
  const card = mockCard({ ...BASE_CONFIG, mood_style_enabled: false });
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  check('5j. toggle off → mood not cached', card._currentMood === null);
  check('5k. toggle off → legacy tier (groovy at 91 BPM)',
    effectiveTierForBpm(91.07, null) === 1);
  stopDanceCycle(card);
}

// Mood signature participates in the firehose gate: a mood-entity-only
// change (same state strings) must NOT be gated away.
{
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  const aggrAttrs = { mood_scores: { aggressive: 0.9, party: 0.1, relaxed: 0.05 } };
  const delivered = applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'aggressive', moodAttrs: aggrAttrs }));
  check('5l. mood-entity-only change passes the firehose gate', delivered === true);
  stopDanceCycle(card);
  // And an identical re-delivery IS gated.
  const gated = applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'aggressive', moodAttrs: aggrAttrs }));
  check('5m. identical re-delivery gated', gated === false);
}

// ── 6. Dance lid floor ──────────────────────────────────────────────────

console.log('6. dance lid floor');
{
  // Relaxed @ 91 BPM: effective tier 0, lid floor must be the sleepy 0.3.
  const card = mockCard(BASE_CONFIG);
  card._state = 'dancing';
  const relaxedAttrs = { mood_scores: { aggressive: 0.01, party: 0.05, relaxed: 0.94 }, mood_label: 'relaxed' };
  startDanceCycle(card, 91.07, parseMood(relaxedAttrs));
  const firstLid = card.animator.baseLidCalls[0];
  check('6a. relaxed mood raises the lid floor to 0.3',
    firstLid >= MOOD_LID_RELAXED, `first lid=${firstLid}`);
  stopDanceCycle(card);
}
{
  // Party @ 91 BPM: awake floor 0.05 < BPM floor 0.15 → BPM floor governs.
  const card = mockCard(BASE_CONFIG);
  card._state = 'dancing';
  startDanceCycle(card, 91.07, parseMood(REAL_PAYLOAD));
  const firstLid = card.animator.baseLidCalls[0];
  check('6b. party mood leaves the BPM floor in charge (0.15)',
    firstLid >= 0.15, `first lid=${firstLid}`);
  stopDanceCycle(card);
}
{
  // No mood: legacy floor exactly.
  const card = mockCard(BASE_CONFIG);
  card._state = 'dancing';
  startDanceCycle(card, 91.07, null);
  const firstLid = card.animator.baseLidCalls[0];
  check('6c. no mood → legacy BPM-only floor', firstLid >= 0.15, `first lid=${firstLid}`);
  stopDanceCycle(card);
}

// ── 7. Mood-entity source (5.7.0) ───────────────────────────────────────

console.log('7. mood-entity source (AX BPM 3.3.0+ split)');
{
  // The label comes from the entity STATE, the scores from its ATTRIBUTES.
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  check('7a. label from state + scores from attributes → dancing with party mood',
    card._state === 'dancing' && card._currentMood && card._currentMood.tierShift === 1);
  stopDanceCycle(card);
}
{
  // No mood entity configured → neutral mood, plain BPM style. The mood
  // directive is the neutral OBJECT (present: false), not null — null is
  // reserved for mood_style_enabled=false (full legacy parity).
  const card = mockCard({ ...BASE_CONFIG, mood_entity: '' });
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  check('7b. no mood_entity → neutral mood (plain BPM style)',
    card._state === 'dancing' && card._currentMood && card._currentMood.present === false);
  stopDanceCycle(card);
}
{
  // Mood entity missing from hass.states → neutral mood.
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: null }));
  check('7c. mood entity absent from hass → neutral mood',
    card._state === 'dancing' && card._currentMood && card._currentMood.present === false);
  stopDanceCycle(card);
}
{
  // unknown / unavailable mood states → neutral mood (no stale steering).
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'unknown', moodAttrs: REAL_PAYLOAD }));
  check('7d. unknown mood state → neutral mood',
    card._state === 'dancing' && card._currentMood && card._currentMood.present === false);
  stopDanceCycle(card);
  const card2 = mockCard(BASE_CONFIG);
  applyHassUpdate(card2, hass({ media: 'playing', bpm: '91.07', moodState: 'unavailable', moodAttrs: REAL_PAYLOAD }));
  check('7e. unavailable mood state → neutral mood',
    card2._state === 'dancing' && card2._currentMood && card2._currentMood.present === false);
  stopDanceCycle(card2);
}
{
  // electronic/acoustic labels are valid states but not steerable — they
  // parse to present-with-neutral-directives (soft tint only).
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({
    media: 'playing', bpm: '91.07', moodState: 'electronic',
    moodAttrs: { mood_scores: { aggressive: 0.1, party: 0.2, relaxed: 0.1, electronic: 0.8, acoustic: 0.05 } },
  }));
  check('7f. electronic label → present but tier-neutral',
    card._state === 'dancing' && card._currentMood && card._currentMood.present === true && card._currentMood.tierShift === 0);
  stopDanceCycle(card);
}
{
  // A mood-entity-only change (BPM state string identical) passes the
  // firehose gate — the mood signature is a tracked value.
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }));
  const delivered = applyHassUpdate(card, hass({ media: 'playing', bpm: '91.07', moodState: 'relaxed', moodAttrs: { mood_scores: { aggressive: 0.01, party: 0.05, relaxed: 0.94 } } }));
  check('7g. mood-state-only change passes the firehose gate', delivered === true);
  stopDanceCycle(card);
}
{
  // sanitizeConfig normalizes a missing/non-string mood_entity to ''.
  const { sanitizeConfig } = await import('../src/config.js');
  const c = sanitizeConfig({ entity: 'assist_satellite.x' });
  check('7h. sanitizeConfig defaults mood_entity to empty string', c.mood_entity === '');
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('ALL CHECKS PASSED');