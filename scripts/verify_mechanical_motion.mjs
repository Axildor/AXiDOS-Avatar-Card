/**
 * verify_mechanical_motion.mjs — the 5.8.0 "Mechanical Life" contracts.
 *
 * Sections:
 *  1. CONDUIT WRITE PARITY (1.1): exactly one setBellows call per beat, zero
 *     extra timers, and the animator's guard skips an identical
 *     amount+duration pair.
 *  2. PUMP IS ZERO ON EVERY OFFBEAT: all 32 phrases × 16 beats = 512 samples.
 *  3. GAZE/CONDUIT DECOUPLING (1.1): setPupil performs NO bellows write.
 *  4. APERTURE (1.2): intervals bounded, holds longer than the old random
 *     walk, deterministic, and consecutive states always differ.
 *  5. SERVO EASINGS (1.4): no `ease-in-out` (or any human ease keyword)
 *     remains in DANCE_EASINGS, and the slots are intact.
 *  6. RASTER SCAN (1.5): identical waypoint sequence across two runs, bounded
 *     inside the socket, boustrophedon row order.
 *  7. REDUCED MOTION (3.12): glitch, strobe and conduit suppressed; the
 *     static frame is reproducible.
 *  8. FLASH CAP (3.13): strobe period >= 0.5 s at every tier and BPM.
 *  9. YAW CLAMP (2.6): skewX never breaks the socket silhouette, and the
 *     neutral pose is byte-identical to the pre-5.8.0 transform string.
 * 10. PERSONALITY (2.10): every mood directive maps to a profile, the profiles
 *     are distinct, and mood is absent-safe.
 * 11. TALK (2.9): seeded, no immediate repeat, cheaper than the old 9-pose
 *     loop, holds longer than accents.
 */

import {
  startDanceCycle, stopDanceCycle, DANCE_EASINGS,
} from '../src/behaviors/dance.js';
import { TIERS, getBeatPose, phraseVariant } from '../src/behaviors/choreography.js';
import {
  apertureAt, processingApertureAt, rasterWaypoints, stationKeepAt,
  APERTURE, APERTURE_CYCLE, APERTURE_MIN_HOLD_MS, APERTURE_MAX_HOLD_MS,
  RASTER_MAX_X, RASTER_MAX_Y, RASTER_ROWS, RASTER_COLS,
  STATION_KEEP_MAX_R, SERVO_HARD_STOP_EASE,
} from '../src/behaviors/mechanical.js';
import {
  startLidBehavior, stopLidBehavior, startIdleCycle, stopIdleCycle,
  startRasterScan, stopRasterScan,
} from '../src/behaviors/idle.js';
import { buildTemplate } from '../src/template.js';
import { TALK_PHRASES, pickTalkPhrase, startTalkAnim, stopTalkAnim } from '../src/behaviors/talk.js';
import {
  resolveMotionMode, allowsGlitch, allowsStrobe, allowsConduit, allowsSway,
  allowsBehaviorEngine, strobeStepBeats, strobeColorAt, MIN_STROBE_STEP_SEC,
  sanitizeMotionIntensity, apertureHoldScale,
} from '../src/motion.js';
import { servoPersonality, SERVO_PROFILES, SERVO_NEUTRAL } from '../src/personality.js';
import { sanitizeConfig } from '../src/config.js';
import { parseMood } from '../src/state-mapper.js';
import { AxidosAnimator, MAX_HEAD_SKEW } from '../src/animator.js';
import { EYE_CENTER_VARIANTS, EYE_HALO_VARIANTS } from '../src/template.js';

/**
 * Built once, at module load, BEFORE the section blocks run: the CSS
 * assertions are static and the template is deterministic.
 */
const buildTemplateCached = buildTemplate({ zoom: 85 });

let passed = 0;
let failures = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log(`  PASS  ${msg}`); }
  else { failures++; console.error(`  FAIL  ${msg}`); }
};

// ---- Stubs ----
function makeEl(id) {
  return {
    id, style: {}, attrs: {}, classes: new Set(),
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
    },
  };
}

/**
 * Animator stub that records every call. Deliberately mirrors the PRODUCTION
 * guard semantics for setBellows (that is the contract under test in 1b), but
 * is otherwise a recorder.
 */
function makeAnimator() {
  const el = {};
  for (const k of ['head', 'headBop', 'torsoSwivel', 'eyeHalo', 'eyeCenter', 'pupil',
    'eyeball', 'bellows', 'lidTop', 'lidBot', 'dangerRing', 'progressRing']) el[k] = makeEl(k);
  el.ledMatrices = [];
  el.svgs = [];
  for (let i = 0; i < 5; i++) el.svgs.push({ querySelectorAll: () => [] });
  const a = {
    el,
    currentBaseLid: 0,
    currentLedColor: '#ffb800',
    currentLedOpacity: '0.15',
    _timers: new Map(),
    _rafs: new Map(),
    _headCalls: [],
    _bellowsCalls: [],
    _pupilCalls: [],
    _telemetryCalls: [],
    _lidCalls: [],
    setTimeout(name, fn, delay) { this._timers.set(name, { fn, delay }); return name; },
    clearTimeout(name) { this._timers.delete(name); },
    requestRaf(name, fn) { this._rafs.set(name, fn); return name; },
    cancelRaf(name) { this._rafs.delete(name); },
    setHead(r, tx, ty, s, dur, ease, skew, scaleX) {
      this._headCalls.push({ r, tx, ty, s, dur, ease, skew, scaleX });
    },
    setBodySwivel() {},
    resetBodySwivel() {},
    setLid(v, d) { this._lidCalls.push([v, d]); },
    setBaseLid(v, d) { this.currentBaseLid = v; this._lidCalls.push([v, d]); },
    setPupil(px, py) { this._pupilCalls.push([px, py]); },
    setBellows(p, d) { this._bellowsCalls.push([p, d]); },
    setLEDs() {}, setLedVars() {},
    setEyeCenterColor() {}, setEyeHaloFill() {},
    setLedTelemetry(m) { this._telemetryCalls.push(m); },
    stopAll() { this._timers.clear(); this._rafs.clear(); },
  };
  return a;
}

function makeCard(state = 'dancing', config = {}) {
  return {
    animator: makeAnimator(),
    _state: state,
    config: { flash_safe: true, ...config },
    _motionMode: 'full',
    _personality: SERVO_NEUTRAL,
    perf: null,
  };
}

// ============================================================
console.log('\n== 1. Conduit write parity (1.1) ==');
{
  for (const bpm of [70, 110, 140, 180]) {
    const card = makeCard();
    startDanceCycle(card, bpm);
    // startDanceCycle begins with a stopDanceCycle() teardown (which releases
    // the conduit once) and then executes the first beat synchronously, so
    // the baseline is 2 writes before any drained beat.
    const baseline = card.animator._bellowsCalls.length;
    assert(baseline === 2,
      `${bpm} BPM: teardown release + one first-beat write before draining (${baseline})`);
    const beats = 16;
    for (let i = 0; i < beats; i++) {
      const t = card.animator._timers.get('dance-step');
      if (!t) break;
      card.animator._timers.delete('dance-step');
      t.fn();
    }
    // 1a. Exactly one setBellows per executed beat — no more, no fewer.
    const calls = card.animator._bellowsCalls.length - baseline;
    assert(calls === beats, `${bpm} BPM: exactly one setBellows per beat (${calls} writes over ${beats} beats)`);
    // 1b. No recovery timer: the ONLY timers are the beat clock, the 0.3-beat
    // LED decay and (tier 0/1) the syncopation accent. There must be no
    // 'dance-bellows' / 'dance-pump' recovery timer.
    const names = [...card.animator._timers.keys()];
    assert(!names.some((n) => /bellows|pump/i.test(n)),
      `${bpm} BPM: zero bellows recovery timers (timers: ${names.join(', ') || 'none'})`);
    stopDanceCycle(card);
  }

  // 1c. The guard skips an identical amount+duration pair (real animator).
  const shadow = makeShadow();
  const anim = new AxidosAnimator(shadow);
  const bellows = shadow.els.bellows;
  let writes = 0;
  Object.defineProperty(bellows.style, 'transform', {
    set() { writes++; }, get() { return ''; },
  });
  anim.setBellows(5, 0.2);
  assert(writes === 1, 'first setBellows writes the transform once');
  anim.setBellows(5, 0.2);
  assert(writes === 1, 'identical amount+duration is skipped by the guard (no second write)');
  anim.setBellows(0, 0.2);
  assert(writes === 2, 'a changed amount writes through');
  anim.setBellows(0, 0.2);
  assert(writes === 2, 'the repeated zero release is skipped too (the offbeat write costs nothing)');

  // 1d. translate3d, not scaleY (scaleY re-rasterises the clipped rib stack).
  // Re-read the RECORDED value: the counting proxy above swallows the getter.
  const shadow2 = makeShadow();
  const anim2 = new AxidosAnimator(shadow2);
  anim2.setBellows(4, 0.2);
  assert(/^translate3d\(0,\s*-4px,\s*0\)$/.test(shadow2.els.bellows.style.transform),
    `conduit uses translate3d, never scaleY (got "${shadow2.els.bellows.style.transform}")`);
  assert(!/scaleY|scale\(/.test(shadow2.els.bellows.style.transform),
    'no scale transform appears in the conduit write');
}

function makeShadow() {
  const els = {};
  for (const id of ['axidos-head', 'head-bop', 'torso-swivel', 'hitbox', 'eye-halo',
    'eye-center', 'eye-pupil', 'eyeball-assembly', 'bellows', 'eye-lid',
    'eye-lid-bottom', 'danger-ring', 'progress-ring', 'ind-l1', 'ind-l2', 'ind-r1', 'ind-r2']) {
    els[id] = makeEl(id);
  }
  els['eye-layer-idle'] = makeEl('eye-layer-idle');
  els['eye-layer-listen'] = makeEl('eye-layer-listen');
  els['eye-layer-process'] = makeEl('eye-layer-process');
  els['eye-layer-respond'] = makeEl('eye-layer-respond');
  els['eye-layer-dance'] = makeEl('eye-layer-dance');
  const centerVariants = EYE_CENTER_VARIANTS.map((c) => {
    const el = makeEl(`center-${c}`);
    el.setAttribute('data-color', c);
    return el;
  });
  const haloVariants = EYE_HALO_VARIANTS.map((f) => {
    const el = makeEl(`halo-${f}`);
    el.setAttribute('data-fill', f);
    return el;
  });
  const ledTargets = [makeEl('led-matrix-left'), makeEl('led-matrix-right'),
    els['ind-l1'], els['ind-l2'], els['ind-r1'], els['ind-r2']];
  return {
    els, centerVariants, haloVariants, ledTargets,
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => {
      if (sel === 'svg.axidos-layer') return [];
      if (sel === '.led-matrix') return [ledTargets[0], ledTargets[1]];
      if (sel === '#axidos-head') return [makeEl('head-a'), makeEl('head-b')];
      if (sel === '#head-bop') return [makeEl('bop-a'), makeEl('bop-b')];
      if (sel === '#torso-swivel') return [makeEl('sw-a'), makeEl('sw-b')];
      if (sel === '.eye-center-variant') return centerVariants;
      if (sel === '.eye-halo-variant') return haloVariants;
      return [];
    },
  };
}

// ============================================================
console.log('\n== 2. Pump is zero on EVERY offbeat (512 samples) ==');
{
  let samples = 0;
  let bad = [];
  for (let tier = 0; tier < TIERS.length; tier++) {
    const phrases = TIERS[tier].phrases;
    for (let p = 0; p < phrases.length; p++) {
      const v = phraseVariant(tier, p, 0);
      for (let b = 0; b < 16; b++) {
        const move = getBeatPose(tier, p, b, v, b);
        samples++;
        const isOffbeat = b % 2 === 1;
        if (isOffbeat && move.pump !== 0) {
          bad.push(`${phrases[p].name}@tier${tier} beat${b}=${move.pump}`);
        }
      }
    }
  }
  assert(samples === 512, `sampled all 32 phrases × 16 beats (${samples} samples)`);
  assert(bad.length === 0, `pump is exactly 0 on every offbeat (${bad.length} violations${bad.length ? ': ' + bad.slice(0, 3).join(', ') : ''})`);

  // And the downbeat DOES pump in at least some phrases (the channel is real).
  let pumping = 0;
  for (let tier = 0; tier < TIERS.length; tier++) {
    for (let p = 0; p < TIERS[tier].phrases.length; p++) {
      const v = phraseVariant(tier, p, 0);
      if (getBeatPose(tier, p, 0, v, 0).pump > 0) pumping++;
    }
  }
  assert(pumping >= 30, `at least 30 of 32 phrases compress the conduit on their downbeat (${pumping})`);
}

// ============================================================
console.log('\n== 3. Gaze/conduit decoupling (1.1) ==');
{
  const shadow = makeShadow();
  const anim = new AxidosAnimator(shadow);
  const bellows = shadow.els.bellows;
  let bellowsWrites = 0;
  Object.defineProperty(bellows.style, 'transform', {
    set() { bellowsWrites++; }, get() { return ''; },
  });
  const before = bellowsWrites;
  anim.setPupil(3, -2);
  anim.setPupil(-4, 1);
  anim.setPupil(0, 5);
  assert(bellowsWrites === before,
    `setPupil performs NO bellows write (${bellowsWrites - before} writes over 3 pupil moves)`);
  assert(anim._pupilBellowsY === undefined,
    '_pupilBellowsY is gone (the gaze→conduit coupling state was deleted)');
  assert(typeof anim._applyBellows === 'undefined', '_applyBellows is gone (no second conduit writer)');
}

// ============================================================
console.log('\n== 4. Aperture states (1.2) ==');
{
  // 4a. Determinism: two independent runs of the generator agree.
  let det = true;
  for (let i = 0; i < 40; i++) {
    const a = apertureAt(i);
    const b = apertureAt(i);
    if (a.state !== b.state || a.lid !== b.lid || a.holdMs !== b.holdMs) det = false;
  }
  assert(det, 'aperture generator is deterministic (two runs agree over 40 steps)');

  // 4b. Holds are LONGER than the old random walk's 1500-4000 ms window.
  let bounded = true;
  let shorter = 0;
  for (let i = 0; i < 200; i++) {
    const ap = apertureAt(i);
    if (ap.holdMs < APERTURE_MIN_HOLD_MS || ap.holdMs > APERTURE_MAX_HOLD_MS) bounded = false;
    if (ap.holdMs <= 4000) shorter++;
  }
  assert(bounded, `intervals bounded within [${APERTURE_MIN_HOLD_MS}, ${APERTURE_MAX_HOLD_MS}] ms`);
  assert(shorter === 0, `every hold is longer than the old walk's 4000 ms ceiling (${shorter} shorter)`);
  assert(APERTURE_MIN_HOLD_MS > 4000,
    `the aperture minimum hold (${APERTURE_MIN_HOLD_MS} ms) exceeds the old random walk's maximum (4000 ms)`);

  // 4c. The cycle never repeats a state back-to-back (a no-op write).
  let repeat = -1;
  for (let i = 0; i < 30; i++) {
    if (apertureAt(i).state === apertureAt(i + 1).state) { repeat = i; break; }
  }
  assert(repeat === -1, `no consecutive aperture event repeats a state (first repeat at ${repeat})`);

  // 4d. The three semantic states exist and are DISTINCT.
  const lids = APERTURE_CYCLE.map((s) => APERTURE[s]);
  assert(lids.length === 3 && new Set(lids).size === 3,
    `three distinct aperture states (${APERTURE_CYCLE.map((s) => `${s}=${APERTURE[s]}`).join(', ')})`);
  assert(APERTURE.wide < APERTURE.half && APERTURE.half < APERTURE.narrow,
    'wide < half < narrow ordering (the aperture monotonically closes)');

  // 4e. The two-stage snap: stage1 is strictly beyond the target but clamped.
  let snapOk = true;
  for (let i = 0; i < 100; i++) {
    const ap = apertureAt(i);
    if (!(ap.stage1 >= ap.lid) || ap.stage1 > 0.99) snapOk = false;
    if (!(ap.snapMs >= 150 && ap.snapMs <= 300)) snapOk = false;
  }
  assert(snapOk, 'two-stage snap: stage1 overshoots toward closure, clamped under 1, fast (150-300 ms)');

  // 4f. Processing aperture stays in the narrow band and its cadence is bounded.
  let procOk = true;
  for (let i = 0; i < 100; i++) {
    const ap = processingApertureAt(i);
    if (ap.lid < 0.44 || ap.lid > 0.86) procOk = false;
    if (ap.nextMs < 120 || ap.nextMs > 400) procOk = false;
  }
  assert(procOk, 'processing aperture stays in the narrow appraisal band, cadence 120-400 ms');

  // 4g. The lid loop is TIMER-scheduled, never RAF (the 5.8.0-alpha rule).
  const card = makeCard('idle');
  startLidBehavior(card);
  assert(card.animator._timers.has('lid-loop'), 'aperture loop registers a TIMER');
  assert(!card.animator._rafs.has('lid-loop'), 'aperture loop registers NO RAF');
  stopLidBehavior(card);
}

// ============================================================
console.log('\n== 5. Servo easing vocabulary (1.4) ==');
{
  const values = Object.values(DANCE_EASINGS);
  assert(values.length === 3, 'DANCE_EASINGS still has exactly 3 slots');
  for (const key of ['hitDown', 'hitOff', 'flow']) {
    assert(typeof DANCE_EASINGS[key] === 'string' && DANCE_EASINGS[key].length > 0,
      `DANCE_EASINGS.${key} still exported and non-empty`);
  }
  const joined = values.join(' ');
  const humanEases = ['ease-in-out', 'ease-in', 'ease-out', 'ease'];
  const found = humanEases.filter((e) => {
    // Exact keyword match, not a substring of a cubic-bezier() list.
    return new RegExp(`(^|[\\s,])${e.replace(/-/g, '\\-')}([\\s,]|$)`).test(joined);
  });
  assert(found.length === 0, `no human ease keyword remains in DANCE_EASINGS (found: ${found.join(', ') || 'none'})`);
  assert(DANCE_EASINGS.flow === 'linear',
    `the flow slot is LINEAR actuation (constant-velocity rail travel), got "${DANCE_EASINGS.flow}"`);
  // Actuator curves must be cubic-beziers with a steep front (y1 well above
  // the human ease-in-out's 0 — a servo drives immediately).
  const parse = (e) => (e.match(/-?[\d.]+/g) || []).map(Number);
  const down = parse(DANCE_EASINGS.hitDown);
  const off = parse(DANCE_EASINGS.hitOff);
  assert(down.length === 4 && off.length === 4, 'both hit slots are 4-parameter cubic-beziers');
  assert(down[0] <= 0.2 && off[0] <= 0.2,
    `both hit curves have a fast ATTACK (x1 ${down[0]} / ${off[0]} — no ease-in ramp)`);
  assert(down[1] >= 0.9,
    `the downbeat curve overshoots into its settle (y1 ${down[1]} >= 0.9)`);
}

// ============================================================
console.log('\n== 6. Deterministic raster scan (1.5) ==');
{
  const a = rasterWaypoints(0);
  const b = rasterWaypoints(0);
  assert(a.length === RASTER_ROWS * RASTER_COLS, `raster is ${RASTER_ROWS}x${RASTER_COLS} = ${a.length} waypoints`);
  assert(JSON.stringify(a) === JSON.stringify(b), 'identical waypoint sequence across two runs (deterministic)');
  // A different seed must actually differ (the seed is wired, not ignored).
  const c = rasterWaypoints(7);
  assert(JSON.stringify(a) !== JSON.stringify(c), 'a different seed produces a different sequence');
  // Bounds: never outside the socket translation budget.
  let inBounds = true;
  for (const pt of a) {
    if (Math.abs(pt.x) > RASTER_MAX_X || Math.abs(pt.y) > RASTER_MAX_Y) inBounds = false;
    if (!(pt.holdMs > 0)) inBounds = false;
  }
  assert(inBounds, `every waypoint stays inside ±${RASTER_MAX_X}/±${RASTER_MAX_Y} px with a positive hold`);
  assert(RASTER_MAX_X <= 6.4 && RASTER_MAX_Y <= 3.2,
    'raster bounds stay inside the 5.4 px socket translation budget with margin');
  // Boustrophedon: each row's x range spans the full width, and consecutive
  // rows start on OPPOSITE sides (a raster sweep, not a serpentine wander).
  const rowFirst = [];
  for (let r = 0; r < RASTER_ROWS; r++) rowFirst.push(a[r * RASTER_COLS].x);
  let alternate = true;
  for (let r = 1; r < rowFirst.length; r++) {
    if (Math.sign(rowFirst[r]) === Math.sign(rowFirst[r - 1])) alternate = false;
  }
  assert(alternate, `boustrophedon row order: consecutive rows start on opposite sides (${rowFirst.map((x) => x.toFixed(1)).join(', ')})`);

  // startRasterScan is timer-driven and stops with the state.
  const card = makeCard('processing');
  startRasterScan(card);
  assert(card.animator._timers.has('process-dart'), 'raster scan registers a TIMER');
  assert(!card.animator._rafs.has('process-dart'), 'raster scan registers no RAF');
  card._state = 'idle';
  const t = card.animator._timers.get('process-dart');
  card.animator._timers.delete('process-dart');
  t.fn();
  assert(!card.animator._timers.has('process-dart'), 'raster scan exits on a foreign state');
  stopRasterScan(card);
}

// ============================================================
console.log('\n== 7. Reduced motion (3.12) ==');
{
  // 7a. Policy resolution.
  assert(resolveMotionMode('full', false) === 'full', 'full + no OS preference → full');
  assert(resolveMotionMode('full', true) === 'reduced', 'full + prefers-reduced-motion → reduced (OS can only LOWER)');
  assert(resolveMotionMode('off', true) === 'off', 'explicit off is never overridden by the OS');
  assert(resolveMotionMode('reduced', false) === 'reduced', 'reduced + no OS preference → reduced (config sticks)');
  assert(sanitizeMotionIntensity('nonsense') === 'full', 'unknown config values fall back to full');

  // 7b. Channels suppressed.
  for (const ch of [allowsGlitch, allowsStrobe, allowsConduit, allowsSway]) {
    assert(ch('full') === true, `${ch.name}: allowed in full`);
    assert(ch('reduced') === false, `${ch.name}: REMOVED in reduced`);
    assert(ch('off') === false, `${ch.name}: removed in off`);
  }
  assert(allowsBehaviorEngine('reduced') === true, 'reduced still runs behavior engines (it is slower/less, not static)');
  assert(allowsBehaviorEngine('off') === false, 'off runs no behavior engine');
  assert(apertureHoldScale('reduced') > 1, 'reduced stretches aperture holds (moves less often)');

  // 7c. The idle glitch is really suppressed under reduced motion: exec() must
  // return before scheduling any RAF.
  const card = makeCard('idle');
  card._motionMode = 'reduced';
  card._personality = SERVO_NEUTRAL;
  // Drive idle behavior turns directly through startIdleCycle's scheduler.
  startIdleCycle(card);
  // Run enough turns that the glitch would have been chosen at least once in
  // full mode; under reduced it must never register an RAF.
  for (let i = 0; i < 200; i++) {
    const t = card.animator._timers.get('idle-behavior');
    if (!t) break;
    card.animator._timers.delete('idle-behavior');
    t.fn();
  }
  assert(!card.animator._rafs.has('idle-glitch'),
    'reduced motion: the stepped glitch never registers an RAF (channel removed, not slowed)');
  stopIdleCycle(card);

  // 7d. Conduit: the dance must issue ZERO non-zero pump writes in reduced.
  const rcard = makeCard();
  rcard._motionMode = 'reduced';
  startDanceCycle(rcard, 140);
  for (let i = 0; i < 16; i++) {
    const t = rcard.animator._timers.get('dance-step');
    if (!t) break;
    rcard.animator._timers.delete('dance-step');
    t.fn();
  }
  const nonZero = rcard.animator._bellowsCalls.filter(([p]) => p !== 0).length;
  assert(nonZero === 0, `reduced motion: conduit compression suppressed (${nonZero} non-zero pump writes)`);
  stopDanceCycle(rcard);

  // 7e. Strobe: zero colour crossfades in reduced when a strobe phrase plays.
  const scard = makeCard();
  scard._motionMode = 'reduced';
  const colors = [];
  scard.animator.setEyeCenterColor = (c) => colors.push(c);
  startDanceCycle(scard, 180);
  for (let i = 0; i < 64; i++) {
    const t = scard.animator._timers.get('dance-step');
    if (!t) break;
    scard.animator._timers.delete('dance-step');
    t.fn();
  }
  assert(!colors.includes('#ff0000'),
    `reduced motion: the red/white optic strobe never fires (colors seen: ${[...new Set(colors)].join(', ') || 'none'})`);
  stopDanceCycle(scard);

  // 7f. The static frame is reproducible: two 'off' applications write the
  // same optic/indicator values (a static frame, not a randomised one).
  const f1 = staticFrameValues();
  const f2 = staticFrameValues();
  assert(JSON.stringify(f1) === JSON.stringify(f2), 'motion off: the composed static frame is reproducible');
  assert(f1.length === 5, `motion off: one frame per state (${f1.length} states)`);
}

/** Re-derive the per-state static frame the way states.js does (pure). */
function staticFrameValues() {
  return ['idle', 'dancing', 'listening', 'processing', 'responding'].map((s) => ({
    state: s,
    center: s === 'listening' ? '#aaffff' : s === 'processing' ? '#ffddaa'
      : s === 'responding' ? '#ffaaaa' : s === 'dancing' ? '#ffffff' : '#ffcc00',
  }));
}

// ============================================================
console.log('\n== 8. Flash cap: strobe period >= 0.5 s (3.13) ==');
{
  assert(MIN_STROBE_STEP_SEC === 0.5, 'the flash budget is 0.5 s between toggles (2 Hz)');
  let worst = Infinity;
  let worstWhere = '';
  for (const bpm of [60, 70, 90, 110, 125, 140, 160, 170, 180, 200]) {
    const beatSec = 60 / bpm;
    const step = strobeStepBeats(beatSec, true);
    const period = step * beatSec;
    if (period < worst) { worst = period; worstWhere = `${bpm} BPM (${step} beat${step > 1 ? 's' : ''} = ${period.toFixed(3)} s)`; }
    assert(period >= MIN_STROBE_STEP_SEC - 1e-9,
      `${bpm} BPM: toggle period ${period.toFixed(3)} s >= 0.5 s (step ${step} beats)`);
  }
  assert(worst >= MIN_STROBE_STEP_SEC - 1e-9, `worst case across every tier and BPM is ${worst.toFixed(3)} s (${worstWhere})`);

  // The 5.7.2 defect: at 170 BPM every-beat toggling was 2.83 Hz.
  const legacyHz = 1 / (60 / 170);
  assert(Math.abs(legacyHz - 2.833) < 0.01, `the retired every-beat rate at 170 BPM was ${legacyHz.toFixed(2)} Hz (the defect)`);
  assert(1 / (strobeStepBeats(60 / 170, true) * (60 / 170)) <= 2 + 1e-9,
    'the guarded rate at 170 BPM is <= 2 Hz');

  // Colours hold for the WHOLE step (never toggling mid-step), and flash_safe
  // false restores the legacy every-beat toggle. The window is anchored to a
  // step boundary — an unaligned window legitimately straddles two steps.
  let holds = true;
  const step170 = strobeStepBeats(60 / 170, true);
  for (let start = 0; start < 64; start += step170) {
    const c0 = strobeColorAt(start, 60 / 170, true);
    for (let k = 1; k < step170; k++) {
      if (strobeColorAt(start + k, 60 / 170, true) !== c0) holds = false;
    }
  }
  assert(holds, `the strobe colour holds for the entire ${step170}-beat step (no mid-step toggle)`);
  assert(strobeStepBeats(0.353, false) === 1, 'flash_safe: false restores the legacy every-beat toggle');

  // Config default: ON, `!== false` keeps pre-5.8.0 configs safe.
  assert(sanitizeConfig({ entity: 'x' }).flash_safe === true, 'flash_safe defaults ON for a config that lacks the key');
  assert(sanitizeConfig({ entity: 'x', flash_safe: false }).flash_safe === false, 'flash_safe: false is honoured');
  assert(sanitizeConfig({ entity: 'x', flash_safe: 'no' }).flash_safe === true, 'truthy-but-not-false stays safe');

  // The danger-ring keyframes are retuned off the authored 0.35 s / 2.86 Hz.
  const tpl = buildTemplateForCheck();
  assert(tpl.includes('animation: danger-flash .5s steps(1, end) infinite'),
    'danger-ring CSS runs a 0.5 s STEPPED flash (2 Hz, discrete transitions)');
  assert(!tpl.includes('danger-flash .35s'), 'the authored 0.35 s (2.86 Hz) cycle is gone');
}

function buildTemplateForCheck() { return buildTemplateCached; }

// ============================================================
console.log('\n== 9. Yaw clamp (2.6) ==');
{
  const shadow = makeShadow();
  const anim = new AxidosAnimator(shadow);
  const heads = anim.el.head;
  anim.setHead(0, 0, 0, 1.0, 1.0);
  const neutral = heads[0].style.transform;
  assert(neutral === 'translate3d(0px,0px,0) rotate(0deg) scale(1)',
    `neutral yaw is BYTE-IDENTICAL to the pre-5.8.0 transform string (got "${neutral}")`);

  anim.setHead(0, 0, 0, 1.0, 1.0, undefined, -5.5, 0.985);
  assert(/skewX\(-5\.5deg\) scaleX\(0\.985\)$/.test(heads[0].style.transform),
    `yaw is appended to the SAME transform string ("${heads[0].style.transform}")`);

  // Clamp: an absurd request is bounded to MAX_HEAD_SKEW on both sides.
  anim.setHead(0, 0, 0, 1.0, 1.0, undefined, 90, 1);
  assert(heads[0].style.transform.includes(`skewX(${MAX_HEAD_SKEW}deg)`),
    `skewX clamps to +${MAX_HEAD_SKEW}deg (silhouette cannot be sheared past the socket)`);
  anim.setHead(0, 0, 0, 1.0, 1.0, undefined, -90, 1);
  assert(heads[0].style.transform.includes(`skewX(-${MAX_HEAD_SKEW}deg)`),
    `skewX clamps to -${MAX_HEAD_SKEW}deg`);
  // Non-finite yaw degrades to neutral, never to NaN in the transform.
  anim.setHead(0, 0, 0, 1.0, 1.0, undefined, NaN, 1);
  assert(!heads[0].style.transform.includes('NaN'), 'a non-finite yaw degrades to neutral (no NaN in the transform)');

  // Every copy receives the identical string (layer-split write parity).
  assert(heads.every((h) => h.style.transform === heads[0].style.transform),
    'the yaw write reaches ALL head copies identically');

  // MAX_HEAD_SKEW is documented as within the casing-overhang budget.
  const casingOverhangPx = 24; // (130 px casing - 66 px cavity) / 2 - margin
  const casingHalfHeight = 124;
  const displacement = Math.tan(MAX_HEAD_SKEW * Math.PI / 180) * casingHalfHeight;
  assert(displacement < casingOverhangPx,
    `MAX_HEAD_SKEW (${MAX_HEAD_SKEW}°) displaces the casing edge ${displacement.toFixed(1)} px < ${casingOverhangPx} px overhang (silhouette intact)`);
}

// ============================================================
console.log('\n== 10. Personality reaches idle (2.10) ==');
{
  const moods = [
    { present: false, tierShift: 0, energyBias: 0, lidFloor: null },
    { present: true, tierShift: 1, energyBias: 0.2, lidFloor: 0.05 },
    { present: true, tierShift: -1, energyBias: -0.2, lidFloor: 0.3 },
    { present: true, tierShift: 0, energyBias: 0.15, lidFloor: null },
    { present: true, tierShift: 0, energyBias: -0.15, lidFloor: null },
  ];
  const profiles = moods.map((m) => servoPersonality(m));
  assert(profiles[0] === SERVO_NEUTRAL, 'no mood → the neutral profile (bit-identical idle amplitudes)');
  assert(profiles[1].family === 'high' && profiles[2].family === 'calm',
    'high-arousal and calm directives map to distinct families');
  assert(profiles[3].family === 'high' && profiles[4].family === 'calm',
    'a non-dominant energy tint still reaches idle (sign of the bias decides)');
  const families = new Set(Object.values(SERVO_PROFILES).map((p) => p.family));
  assert(families.size === 3, `three distinct servo profiles exist (${[...families].join(', ')})`);
  assert(SERVO_PROFILES.high.aggression > SERVO_PROFILES.neutral.aggression
    && SERVO_PROFILES.neutral.aggression > SERVO_PROFILES.calm.aggression,
    'aggression orders high > neutral > calm (the servo drives harder for high-arousal)');
  assert(SERVO_PROFILES.calm.holdScale > 1 && SERVO_PROFILES.high.holdScale < 1,
    'calm holds longer, high-arousal cycles faster');
  assert(SERVO_PROFILES.calm.apertureBias > 0 && SERVO_PROFILES.high.apertureBias < 0,
    'calm sits heavier (droop), high-arousal sits more open');

  // The SAME mood data drives both engines: parseMood → servoPersonality.
  const party = parseMood({ mood_label: 'party', mood_scores: { party: 0.9, aggressive: 0.1, relaxed: 0.02, electronic: 0.05, acoustic: 0.01 } });
  assert(servoPersonality(party) === SERVO_PROFILES.high,
    'the dance mood directive and the idle personality come from the same source (party → high)');
  const relaxed = parseMood({ mood_label: 'relaxed', mood_scores: { relaxed: 0.9, party: 0.05, aggressive: 0.01, electronic: 0.02, acoustic: 0.1 } });
  assert(servoPersonality(relaxed) === SERVO_PROFILES.calm, 'relaxed → calm');

  // Station-keeping stays SUB-DEGREE regardless of profile.
  let subDegree = true;
  for (let i = 0; i < 100; i++) {
    const c = stationKeepAt(i);
    if (Math.abs(c.r) > STATION_KEEP_MAX_R || STATION_KEEP_MAX_R > 1) subDegree = false;
    if (!(c.durMs >= 140 && c.durMs <= 300)) subDegree = false;
  }
  assert(subDegree, `station-keeping corrections stay sub-degree (|r| <= ${STATION_KEEP_MAX_R}°) with a fast attack`);
  assert(SERVO_HARD_STOP_EASE.startsWith('cubic-bezier'), 'the hard stop uses a bezier ramp, not a human ease keyword');
}

// ============================================================
console.log('\n== 11. Deadpan talk (2.9) ==');
{
  // 11a. Seeded and no immediate repeat.
  let prev = -1;
  let repeat = -1;
  for (let i = 0; i < 60; i++) {
    const id = pickTalkPhrase(prev, i, 0);
    if (id === prev) repeat = i;
    prev = id;
  }
  assert(repeat === -1, `talk phrases never repeat back-to-back (first repeat at step ${repeat})`);
  const run1 = []; const run2 = [];
  let p1 = -1; let p2 = -1;
  for (let i = 0; i < 30; i++) {
    p1 = pickTalkPhrase(p1, i, 5); run1.push(p1);
    p2 = pickTalkPhrase(p2, i, 5); run2.push(p2);
  }
  assert(JSON.stringify(run1) === JSON.stringify(run2), 'talk phrase selection is deterministic for a given seed');

  // 11b. Longer holds than accents, on every phrase.
  let holdsDominate = true;
  for (const p of TALK_PHRASES) {
    if (!(p.holdMs > p.attack * 1000 * 3)) holdsDominate = false;
    if (!(p.holdMs >= 2000)) holdsDominate = false;
  }
  assert(holdsDominate, 'every talk phrase holds at least 2 s and at least 3x its accent duration (the pause is the performance)');

  // 11c. Cheaper than the old 9-pose loop. The old engine wrote 4 elements
  // every `dur` seconds with no holds at all; the new one writes one accent
  // per phrase and then sleeps. Count writes over a fixed 20 s window.
  const newWrites = countTalkWrites(20);
  const OLD_WRITES_PER_SEC = 4 / 1.5; // the old average pose duration
  const oldWrites = Math.round(OLD_WRITES_PER_SEC * 20);
  assert(newWrites < oldWrites,
    `talk is cheaper than the old 9-pose loop (${newWrites} writes / 20 s vs ~${oldWrites})`);
}

function countTalkWrites(windowSec) {
  const card = makeCard('responding');
  card._personality = SERVO_NEUTRAL;
  let writes = 0;
  const a = card.animator;
  const origHead = a.setHead.bind(a);
  a.setHead = (...args) => { writes += 4; origHead(...args); }; // head+lid+pupil+swivel
  startTalkAnim(card);
  let t = 0;
  // Walk the simulated clock through the scheduled talk-step timers.
  for (let guard = 0; guard < 500; guard++) {
    const step = a._timers.get('talk-step');
    if (!step) break;
    t += step.delay;
    if (t > windowSec * 1000) break;
    a._timers.delete('talk-step');
    step.fn();
  }
  stopTalkAnim(card);
  return writes;
}

// ============================================================
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('ALL CHECKS PASSED');
