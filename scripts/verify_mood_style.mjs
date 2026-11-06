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

import { applyHassUpdate, resolveMoodEntity, DEFAULT_MOOD_ENTITY } from '../src/hass-update.js';
import {
  parseMood, moodSignature, MOOD_CONFIDENCE, MOOD_LID_RELAXED, MOOD_LID_AWAKE,
  MOOD_LID_PARTY, MOOD_LID_ACOUSTIC, MOOD_LID_ELECTRONIC, MOOD_HEAD_BY_LABEL,
} from '../src/state-mapper.js';
import { getEnergy } from '../src/behaviors/choreography.js';
import {
  startDanceCycle, stopDanceCycle, tierForBpm, effectiveTierForBpm, resolveLidFloor,
} from '../src/behaviors/dance.js';

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
  // 5.7.2: party and aggressive now carry DISTINCT directives (they were
  // byte-identical, so set_mood: aggressive vs party looked the same).
  // Party is the milder high-arousal head: bias 0.18, floor 0.06.
  check('1c. party energy bias is +0.18', m.energyBias === 0.18, `energyBias=${m.energyBias}`);
  check('1d. party lid floor is the party floor',
    m.lidFloor === MOOD_LID_PARTY && m.lidFloor > MOOD_LID_AWAKE,
    `lidFloor=${m.lidFloor} > awake ${MOOD_LID_AWAKE}`);
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
  // 5.7.2: electronic/acoustic ARE steerable now. Without a label there is
  // no dominance claim, so they still produce no tier shift — but they do
  // tint the energy envelope (electronic up, acoustic mildly down), which
  // is the documented non-dominant behaviour.
  const m4 = parseMood({ mood_scores: { electronic: 0.8, acoustic: 0.1 } });
  check('1m. label-less five-head scores tint energy but never shift tier',
    m4.present === true && m4.tierShift === 0 && m4.energyBias !== 0 && m4.lidFloor === null,
    `bias=${m4.energyBias.toFixed(4)}`);
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
  // Party @ 91 BPM (5.7.2): the mood floor is now AUTHORITATIVE, so the
  // party floor (0.06) REPLACES the BPM floor (0.15) instead of losing to
  // it — this is the dead-branch fix. Pre-5.7.2 this assertion read
  // "party mood leaves the BPM floor in charge (>= 0.15)", which is exactly
  // the inert behaviour being removed.
  const card = mockCard(BASE_CONFIG);
  card._state = 'dancing';
  startDanceCycle(card, 91.07, parseMood(REAL_PAYLOAD));
  const firstLid = card.animator.baseLidCalls[0];
  check('6b. party mood clears the BPM floor (mood floor wins)',
    firstLid < 0.15 && firstLid >= MOOD_LID_PARTY,
    `first lid=${firstLid} (< BPM floor 0.15, >= party floor ${MOOD_LID_PARTY})`);
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
  // SUPERSEDED in 5.7.2: electronic/acoustic used to parse to
  // present-but-neutral (soft tint only), which made two of the five
  // set_mood override choices invisible. All five heads steer now, each
  // with a distinct directive — see section 8.
  const card = mockCard(BASE_CONFIG);
  applyHassUpdate(card, hass({
    media: 'playing', bpm: '91.07', moodState: 'electronic',
    moodAttrs: { mood_scores: { aggressive: 0.1, party: 0.2, relaxed: 0.1, electronic: 0.8, acoustic: 0.05 } },
  }));
  check('7f. electronic label now steers (upshift + soft bias)',
    card._state === 'dancing' && card._currentMood
    && card._currentMood.present === true && card._currentMood.tierShift === 1
    && card._currentMood.energyBias > 0,
    `tier=${card._currentMood && card._currentMood.tierShift}`);
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

// ── 8. All five mood heads steer (5.7.2) ────────────────────────────────

console.log('8. all five mood heads steer');

/** Five-head payload with one head dominant. */
function fiveHead(label, dominant = 0.95, rest = 0.02) {
  const scores = {};
  for (const h of ['aggressive', 'party', 'relaxed', 'electronic', 'acoustic']) {
    scores[h] = h === label ? dominant : rest;
  }
  return { mood_label: label, mood_scores: scores };
}

{
  // THE REGRESSION: before 5.7.2 electronic/acoustic were absent from both
  // the dominance test and the soft formula, so they parsed to
  // present:true / tierShift:0 / energyBias:0.0 — a mood that changed the
  // sensor state and nothing else. Two of the five set_mood override
  // options were decorative.
  for (const head of ['aggressive', 'party', 'relaxed', 'electronic', 'acoustic']) {
    const m = parseMood(fiveHead(head));
    check(`8a.${head} — present and non-neutral`,
      m.present === true && (m.tierShift !== 0 || m.energyBias !== 0 || m.lidFloor !== null),
      `tier=${m.tierShift} bias=${m.energyBias.toFixed(3)} lid=${m.lidFloor}`);
  }
}

{
  // Every head is mapped, and no two heads share a directive tuple (so the
  // five labels stay visually distinguishable).
  const heads = Object.keys(MOOD_HEAD_BY_LABEL).sort();
  check('8b. every one of the five heads is mapped',
    heads.length === 5
    && heads.join(',') === 'acoustic,aggressive,electronic,party,relaxed',
    heads.join(','));
  const tuples = new Set(Object.values(MOOD_HEAD_BY_LABEL).map(
    (h) => `${h.tierShift}|${h.energyBias}|${h.lidFloor}`));
  check('8c. no two heads share a directive tuple', tuples.size === 5, `${tuples.size} distinct`);
}

{
  // Family direction: high-arousal heads upshift and pull energy up; calm
  // heads downshift and pull energy down.
  for (const head of ['aggressive', 'party', 'electronic']) {
    const m = parseMood(fiveHead(head));
    check(`8d.${head} — high-arousal (tier +1, bias > 0)`,
      m.tierShift === 1 && m.energyBias > 0, `tier=${m.tierShift} bias=${m.energyBias}`);
  }
  for (const head of ['relaxed', 'acoustic']) {
    const m = parseMood(fiveHead(head));
    check(`8e.${head} — calm (tier −1, bias < 0)`,
      m.tierShift === -1 && m.energyBias < 0, `tier=${m.tierShift} bias=${m.energyBias}`);
  }
  // Secondary heads steer at reduced weight, as the integration's own
  // arithmetic treats them (electronic = intensity numerator only,
  // acoustic = the weaker calmness numerator).
  const el = parseMood(fiveHead('electronic'));
  const ag = parseMood(fiveHead('aggressive'));
  check('8f. electronic steers softer than aggressive',
    el.energyBias > 0 && el.energyBias < ag.energyBias,
    `${el.energyBias} < ${ag.energyBias}`);
  const ac = parseMood(fiveHead('acoustic'));
  const re = parseMood(fiveHead('relaxed'));
  check('8g. acoustic steers softer than relaxed',
    ac.energyBias < 0 && ac.energyBias > re.energyBias,
    `${ac.energyBias} > ${re.energyBias}`);
}

{
  // The set_mood override path publishes ONE-HOT synthetic scores (integration
  // _mood_attrs_from_override). Each of the five choices must produce a
  // different directive — otherwise the override silently does nothing.
  const seen = new Map();
  for (const head of ['aggressive', 'party', 'relaxed', 'electronic', 'acoustic']) {
    const oneHot = { mood_label: head, mood_scores: {} };
    for (const h of ['aggressive', 'party', 'relaxed', 'electronic', 'acoustic']) {
      oneHot.mood_scores[h] = h === head ? 1.0 : 0.0;
    }
    const m = parseMood(oneHot);
    seen.set(head, `${m.tierShift}|${m.energyBias}|${m.lidFloor}`);
  }
  check('8h. all five one-hot set_mood overrides yield distinct directives',
    new Set(seen.values()).size === 5);
  // One-hot relaxed: the three high heads are 0.0, which must NOT suppress
  // the calm branch (0.0 is a real score, not a missing signal).
  const r = parseMood({ mood_label: 'relaxed', mood_scores: {
    aggressive: 0, party: 0, relaxed: 1, electronic: 0, acoustic: 0 } });
  check('8i. one-hot relaxed keeps the calm branch',
    r.tierShift === -1 && r.lidFloor === MOOD_LID_RELAXED, `lid=${r.lidFloor}`);
}

{
  // Dominance is judged over all five heads: a label that is NOT the max
  // must not steer, even when it is confident. acoustic 0.5 < relaxed 0.9.
  const m = parseMood({
    mood_label: 'acoustic',
    mood_scores: { aggressive: 0.05, party: 0.05, relaxed: 0.9, electronic: 0.05, acoustic: 0.5 },
  });
  check('8j. non-max label does not steer', m.tierShift === 0 && m.lidFloor === null,
    `tier=${m.tierShift} lid=${m.lidFloor}`);
  // Below confidence → neutral tier.
  const low = parseMood({ mood_label: 'electronic', mood_scores: {
    aggressive: 0.1, party: 0.1, relaxed: 0.1, electronic: 0.3, acoustic: 0.1 } });
  check('8k. below MOOD_CONFIDENCE stays tier-neutral', low.tierShift === 0,
    `threshold=${MOOD_CONFIDENCE}`);
  // Missing heads simply do not compete -> the lone present head wins.
  const partial = parseMood({ mood_label: 'party', mood_scores: { party: 0.8 } });
  check('8l. partial score sets still steer on the present heads',
    partial.tierShift === 1 && partial.energyBias === MOOD_HEAD_BY_LABEL.party.energyBias,
    `bias=${partial.energyBias}`);
}

// ── 9. resolveLidFloor precedence (5.7.2) ───────────────────────────────

console.log('9. resolveLidFloor precedence');

{
  // THE DEAD-BRANCH REGRESSION: the old rule was
  //   Math.max(bpmLidFloor, moodLidFloor)
  // with bpmLidFloor 0.15 (<125 BPM) / 0.08 (>=125 BPM). MOOD_LID_AWAKE is
  // 0.05, so the high-arousal floor could NEVER win — "party/aggressive =
  // wide awake" was unreachable at every tempo. A present mood floor now
  // REPLACES the BPM floor.
  check('9a. no mood → legacy BPM floor <125', resolveLidFloor(0.15, null) === 0.15);
  check('9b. no mood → legacy BPM floor >=125', resolveLidFloor(0.08, undefined) === 0.08);
  check('9c. high-arousal floor lowers the <125 BPM floor',
    resolveLidFloor(0.15, MOOD_LID_AWAKE) === MOOD_LID_AWAKE,
    `${resolveLidFloor(0.15, MOOD_LID_AWAKE)} < 0.15`);
  check('9d. high-arousal floor lowers the >=125 BPM floor',
    resolveLidFloor(0.08, MOOD_LID_AWAKE) === MOOD_LID_AWAKE);
  check('9e. calm floor raises the <125 BPM floor',
    resolveLidFloor(0.15, MOOD_LID_RELAXED) === MOOD_LID_RELAXED);
  check('9f. calm floor raises the >=125 BPM floor',
    resolveLidFloor(0.08, MOOD_LID_RELAXED) === MOOD_LID_RELAXED);
  // The resolved floor is a strict ordering across the five heads.
  const order = ['aggressive', 'party', 'electronic', 'acoustic', 'relaxed']
    .map((h) => parseMood(fiveHead(h)).lidFloor);
  check('9g. head floors are strictly ordered awake → sleepy',
    order.every((v, i) => i === 0 || v > order[i - 1]), order.join(' < '));
  check('9h. secondary heads sit between the primaries of their family',
    MOOD_LID_AWAKE < MOOD_LID_ELECTRONIC && MOOD_LID_ELECTRONIC < MOOD_LID_ACOUSTIC
    && MOOD_LID_ACOUSTIC < MOOD_LID_RELAXED);
}

// ── 10. Tier-clamp boundaries (5.7.2) ───────────────────────────────────

console.log('10. tier-clamp boundaries');

{
  // A tier shift that clamps is a NO-OP: relaxed at <90 BPM is already tier
  // 0, party/aggressive at >=160 BPM already tier 3. The mood must still be
  // felt through energyBias + lidFloor, so assert the clamp AND the
  // surviving channels at both boundaries.
  const relaxed = parseMood(fiveHead('relaxed'));
  const party = parseMood(fiveHead('party'));

  check('10a. relaxed at 89 BPM clamps (tier 0 → 0)',
    effectiveTierForBpm(89, relaxed) === tierForBpm(89));
  check('10b. relaxed at 90 BPM un-clamps (tier 1 → 0, chill moves)',
    effectiveTierForBpm(90, relaxed) === 0 && tierForBpm(90) === 1);
  check('10c. party at 159 BPM un-clamps (tier 2 → 3)',
    effectiveTierForBpm(159, party) === 3 && tierForBpm(159) === 2);
  check('10d. party at 160 BPM clamps (tier 3 → 3)',
    effectiveTierForBpm(160, party) === tierForBpm(160));

  // At the clamped extremes the other two channels must still carry mood.
  check('10e. clamped relaxed still biases energy down',
    relaxed.energyBias === -0.2 && relaxed.lidFloor === MOOD_LID_RELAXED);
  check('10f. clamped party still biases energy up',
    party.energyBias === MOOD_HEAD_BY_LABEL.party.energyBias && party.energyBias > 0
    && party.lidFloor === MOOD_LID_PARTY);
  // And the resolved floors genuinely differ from the BPM-only floor. This
  // is THE dead-branch check: with the old max() rule and the old
  // MOOD_LID_AWAKE of 0.05 the floor could never drop below 0.08, so this
  // comparison was 0.08 !== 0.08 — false.
  check('10g. clamped party actually changes the resolved lid floor',
    resolveLidFloor(0.08, party.lidFloor) !== 0.08,
    `resolved ${resolveLidFloor(0.08, party.lidFloor)} vs BPM-only 0.08`);
}

{
  // The high-arousal floors must sit BELOW both BPM floors, otherwise the
  // "wide awake" family is inert again. Pinned against the literals in
  // dance.js (bpmLidFloor = 0.15 / 0.08) so a future retune of either side
  // has to update both deliberately.
  const BPM_FLOOR_LOW = 0.15;   // dance.js: currentBpm < 125
  const BPM_FLOOR_HIGH = 0.08; // dance.js: currentBpm >= 125
  for (const head of ['aggressive', 'party', 'electronic']) {
    const f = parseMood(fiveHead(head)).lidFloor;
    check(`10h.${head} floor is below both BPM floors`,
      f < BPM_FLOOR_LOW && f < BPM_FLOOR_HIGH, `${f} < ${BPM_FLOOR_HIGH} < ${BPM_FLOOR_LOW}`);
  }
  for (const head of ['relaxed', 'acoustic']) {
    const f = parseMood(fiveHead(head)).lidFloor;
    check(`10i.${head} floor is above both BPM floors`,
      f > BPM_FLOOR_LOW && f > BPM_FLOOR_HIGH, `${f} > ${BPM_FLOOR_LOW}`);
  }
}

// ── 11. mood_entity resolution + one-time misconfig warning (5.7.2) ────

console.log('11. mood_entity resolution + misconfig warning');

{
  // An explicitly configured mood_entity always wins.
  const card = mockCard({ ...BASE_CONFIG, mood_entity: 'sensor.custom_mood' });
  check('11a. configured mood_entity wins',
    resolveMoodEntity(card, hass({ moodState: 'party', moodAttrs: REAL_PAYLOAD })) === 'sensor.custom_mood');

  // Empty config + the AX BPM default entity present → auto-adopt it. This
  // restores mood steering for card configs written before the 3.3.0 split,
  // which lost it silently.
  const emptyCard = mockCard({ ...BASE_CONFIG, mood_entity: '' });
  // media must be 'playing' or the card stays idle and never parses mood.
  const h = { states: {
    ...hass({ media: 'playing', bpm: '91.07', moodState: 'party', moodAttrs: REAL_PAYLOAD }).states,
    [DEFAULT_MOOD_ENTITY]: { state: 'party', attributes: REAL_PAYLOAD },
  } };
  check('11b. empty config auto-adopts the AX BPM default entity',
    resolveMoodEntity(emptyCard, h) === DEFAULT_MOOD_ENTITY);
  check('11c. empty config with no default entity resolves to empty',
    resolveMoodEntity(mockCard({ ...BASE_CONFIG, mood_entity: '' }), hass({})) === '');

  // Auto-detection must never touch bpm_entity (the split contract).
  // NOTE: the fixture must carry an EMPTY mood_entity (the post-3.3.0-upgrade
  // case this fix targets). BASE_CONFIG configures sensor.mood explicitly,
  // so reusing it here would never exercise the auto-detect branch.
  const card2 = mockCard({ ...BASE_CONFIG, mood_entity: '' });
  applyHassUpdate(card2, h);
  check('11d. auto-detected mood actually steers the dance',
    card2._state === 'dancing' && card2._currentMood
    && card2._currentMood.present === true && card2._currentMood.tierShift === 1,
    `state=${card2._state} tier=${card2._currentMood && card2._currentMood.tierShift}`);
  stopDanceCycle(card2);
}

{
  // One-time warning: a mood_entity pointing at a sensor with no mood_scores
  // (the natural-but-wrong sensor.ax_bpm) is the silent-degradation case.
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const card = mockCard({ ...BASE_CONFIG, mood_entity: 'sensor.ax_bpm' });
    const badHass = { states: {
      ...hass({ media: 'playing' }).states,
      'sensor.ax_bpm': { state: '91.07', attributes: { source: 'analyzer' } },
    } };
    applyHassUpdate(card, badHass);
    check('11e. wrong mood_entity warns once', warnings.length === 1, `${warnings.length}`);
    check('11f. the warning names the fix',
      /mood_scores|sensor\.ax_bpm_mood/.test(warnings[0] || ''));
    applyHassUpdate(card, badHass);
    applyHassUpdate(card, badHass);
    check('11g. warning is latched (no firehose spam)', warnings.length === 1,
      `${warnings.length} after 3 deliveries`);
    stopDanceCycle(card);
  } finally {
    console.warn = origWarn;
  }

  // mood_style_enabled:false is an explicit opt-out → no warning.
  const warnings2 = [];
  console.warn = (msg) => warnings2.push(String(msg));
  try {
    const card = mockCard({ ...BASE_CONFIG, mood_entity: '', mood_style_enabled: false });
    applyHassUpdate(card, { states: hass({ media: 'playing' }).states });
    check('11h. opting out of mood style does not warn', warnings2.length === 0);
    stopDanceCycle(card);
  } finally {
    console.warn = origWarn;
  }
}

{
  // The entity STATE is authoritative for the label: a stale mood_label
  // inside attributes must never override it (pre-5.7.2 spread order did).
  const card = mockCard(BASE_CONFIG);
  const conflicting = {
    states: {
      ...hass({ media: 'playing', bpm: '91.07' }).states,
      'sensor.mood': {
        state: 'relaxed',
        attributes: {
          // Stale/duplicate label claiming the opposite family.
          mood_label: 'party',
          mood_scores: { aggressive: 0.02, party: 0.02, relaxed: 0.95, electronic: 0.02, acoustic: 0.02 },
        },
      },
    },
  };
  applyHassUpdate(card, conflicting);
  check('11i. entity state wins over an attributes mood_label',
    card._state === 'dancing' && card._currentMood && card._currentMood.tierShift === -1,
    `tier=${card._currentMood && card._currentMood.tierShift}`);
  stopDanceCycle(card);
}

{
  // Path independence (AX-BPM 3.3.1): the mood entity's mood_scores are
  // consumed identically whether the integration published them from the
  // local path, the enrichment path or cache — the card only ever reads
  // the entity, so what matters here is that the attribute-layer keys
  // riding along never change the parsed directive.
  //
  // REAL_PAYLOAD's label is derived from its own argmax ('party' wins at
  // 0.9457), exactly as the integration derives it.
  const label = 'party';
  const bare = parseMood({ mood_label: label, mood_scores: REAL_PAYLOAD.mood_scores });
  const withExtras = parseMood({
    mood_label: label,
    mood_scores: REAL_PAYLOAD.mood_scores,
    mood_source: 'analyzer',
    mood_tags: [{ tag: 'party', score: 0.9 }],
    valence: null, arousal: null, valence_std: null, arousal_std: null,
    danceability: 0.6032, analyzed_seconds: 29.936,
    model_versions: { effnet: 'v1 (2021-11)' },
  });
  check('11j. attribute-layer keys never change the directive',
    bare.present === withExtras.present
    && bare.tierShift === withExtras.tierShift
    && bare.energyBias === withExtras.energyBias
    && bare.lidFloor === withExtras.lidFloor,
    JSON.stringify(withExtras));
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('ALL CHECKS PASSED');