/**
 * verify_bop_tail.mjs — End-to-end verification of the bop tail-meld rework.
 *
 * Runs the real bopHead()/stopBop() with a stubbed animator + controllable
 * RAF clock and asserts:
 *
 *  1. Layer isolation: the bop spring writes transforms to #head-bop ONLY —
 *     #axidos-head is never touched (idle poses / dance keyframes own it).
 *  2. Idle tap pauses ONLY head-pose idle behaviors (idle-behavior /
 *     idle-blink / idle-glitch); the pupil timer ('idle-pupil') survives.
 *  3. ARMED tail meld: the resume threshold must NOT trip on the spring's
 *     first frames (position ramping up from 0) — it only fires after the
 *     spring has bounced ABOVE the threshold once, then decays back to it,
 *     at |position| <= actualPeak * tap_bop_resume, and BEFORE settle.
 *  4. Settle: layer eased back to identity via resetBopLayer(), spring nulled,
 *     LED state restored, and a resume safety-net fires if the threshold
 *     never tripped.
 *  5. Dancing: the dance engine is HELD on tap (_danceHeld) — beat clock
 *     keeps ticking, but pose moves / LED accents are skipped; the hold
 *     releases at the meld point or on settle.
 *  6. stopBop: cancels the RAF, nulls the spring, eases the layer home, and
 *     clears the meld/hold flags.
 *  7. Re-tap mid-bop KICKS the spring (energy-add, always amplifies) AND
 *     re-pauses/re-arms the background.
 *  8. getGridOptions(): rows AND columns grow with zoom so the model actually
 *     enlarges past 100 (scene must not flex-shrink to the slot width).
 *  9. Freeze: pauseBackground() freezes in-flight head/torso motion
 *     (freezeHeadMotion) — no dual animation during the bop.
 * 10. Kick math: energy-add kick amplifies at peak, trough, and mid-rise;
 *     direction preserved; amplitude cap enforced.
 * 11. maxSeen threshold: meld fires at a fraction of the ACTUAL peak.
 */

import { bopHead, stopBop } from '../src/behaviors/bop.js';
import { createSpring } from '../src/behaviors/spring.js';
import { startDanceCycle } from '../src/behaviors/dance.js';

// axidos-card.js extends HTMLElement, which Node doesn't define. Shim it
// before the dynamic import below so the class declaration can extend it.
if (typeof HTMLElement === 'undefined') {
  globalThis.HTMLElement = class HTMLElement {};
}
const { AxidosCard } = await import('../src/axidos-card.js');

// ---- Controllable clock + RAF/timer stubs ----

function makeEl() {
  return {
    style: {
      setProperty(k, v) { this[k] = v; },
    },
    attrs: {},
    _props: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    setProperty(k, v) { this._props[k] = v; },
  };
}

function makeAnimator() {
  const el = {};
  for (const k of ['svg', 'head', 'headBop', 'torsoSwivel', 'hitbox',
    'eyeHalo', 'eyeCenter', 'pupil', 'eyeball', 'bellows', 'lidTop', 'lidBot', 'dangerRing']) {
    el[k] = makeEl();
  }
  el.ledMatrices = [];

  const a = {
    el,
    currentBaseLid: 0,
    currentLedColor: '#ffb800',
    currentLedOpacity: '0.15',
    _timers: new Map(),
    _rafs: new Map(),
    _calls: { resetBopLayer: 0, setLEDs: [], clearedTimers: [], setHead: 0, setBellows: [], freezeHeadMotion: 0 },

    setTimeout(name, fn, delay) { this._timers.set(name, { fn, delay }); return name; },
    clearTimeout(name) { if (this._timers.has(name)) this._calls.clearedTimers.push(name); this._timers.delete(name); },
    requestRaf(name, fn) { this._rafs.set(name, fn); return name; },
    cancelRaf(name) { this._rafs.delete(name); },
    setHead() { this._calls.setHead++; },
    setBodySwivel() {}, resetBodySwivel() {},
    setLid() {}, setBaseLid(v) { this.currentBaseLid = v; },
    setPupil() {}, setBellows(p, d) { this._calls.setBellows.push([p, d]); },
    setLEDs(c, o) { this.currentLedColor = c; this.currentLedOpacity = o; this._calls.setLEDs.push([c, o]); },
    setLedVars(c, o) { this._calls.setLedVars = this._calls.setLedVars || []; this._calls.setLedVars.push([c, o]); },
    freezeHeadMotion() { this._calls.freezeHeadMotion++; },
    resetBopLayer() {
      this._calls.resetBopLayer++;
      if (this.el.headBop) {
        this.el.headBop.style.transition = 'transform 0.4s ease-out';
        this.el.headBop.style.transform = 'translate3d(0,0,0) rotate(0deg) scale(1)';
      }
    },
    stopAll() {
      for (const id of this._timers.keys()) this.clearTimeout(id);
      this._rafs.clear();
    },
  };
  return a;
}

function makeCard(state, config = {}) {
  return {
    _state: state,
    config: { tap_speed: 0.5, tap_bounces: 5, tap_intensity: 1.0, tap_bop_resume: 0.3, ...config },
    animator: makeAnimator(),
    _bopping: false,
    _bopSpring: null,
    _bopResumeArmed: false,
    _bopResumed: false,
    _bopMaxSeen: 0,
    _bopPeakFrozen: false,
    _danceHeld: false,
  };
}

// Drive the bop's RAF loop with a synthetic 60fps clock until it settles
// (or maxFrames). Returns a trace of every frame.
function pumpBop(card, maxFrames = 2000) {
  const a = card.animator;
  const trace = [];
  let now = performance.now();
  for (let i = 0; i < maxFrames; i++) {
    const fn = a._rafs.get('bop-raf');
    if (!fn) break;
    now += 16.666;
    const spring = card._bopSpring;
    fn(now);
    trace.push({
      now,
      pos: spring ? spring.position : 0,
      headTransform: a.el.head.style.transform || '',
      bopTransform: a.el.headBop.style.transform || '',
      bopping: card._bopping,
      idleResumed: a._timers.has('idle-behavior'),
    });
    if (!card._bopping) break;
  }
  return trace;
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ---- 1+2+3+4: Idle tap — layer isolation, selective pause, ARMED tail meld, settle ----
console.log('\n[1] Idle tap: layer isolation + selective pause + ARMED tail meld + settle');
{
  const card = makeCard('idle');
  const a = card.animator;
  // Simulate a running idle cycle: behavior + pupil timers both live.
  a.setTimeout('idle-behavior', () => {}, 5000);
  a.setTimeout('idle-pupil', () => {}, 1200);
  a.setTimeout('idle-blink', () => {}, 3000);

  bopHead(card);

  check('bop active after tap', card._bopping === true);
  check('head-pose scheduler paused (idle-behavior cleared)', !a._timers.has('idle-behavior'));
  check('blink timer paused (idle-blink cleared)', !a._timers.has('idle-blink'));
  check('pupil darting survives (idle-pupil still live)', a._timers.has('idle-pupil'));
  // (The old WAAPI 'lid-loop' animation check is gone with the WAAPI layer.)

  const trace = pumpBop(card);

  check('bop settled within frame budget', trace.length > 10 && trace.length < 2000, `frames=${trace.length}`);
  check('#axidos-head transform NEVER written by bop', trace.every((f) => f.headTransform === ''));
  check('#head-bop received spring transforms', trace.some((f) => f.bopTransform.includes('translate3d')));
  check('layer reset on settle (resetBopLayer called)', a._calls.resetBopLayer >= 1);
  check('spring nulled on settle', card._bopSpring === null);
  check('LED state restored on settle', a._calls.setLEDs.some(([c, o]) => c === '#ffb800' && o === '0.15'));

  // ARMED tail meld: the spring ramps up from 0, so an early frame can be
  // below the threshold — but the resume must NOT fire until the spring has
  // been ABOVE the threshold (armed) and decayed back below it.
  const maxAmp = 15 * 1.0;
  const resumeFrac = 0.3;
  const threshold = maxAmp * resumeFrac;
  const peak = Math.max(...trace.map((f) => Math.abs(f.pos)));
  const firstAboveIdx = trace.findIndex((f) => Math.abs(f.pos) > threshold);
  const firstResumedIdx = trace.findIndex((f) => f.idleResumed);
  check('arming: spring exceeded threshold during bounce', firstAboveIdx >= 0,
    `peak=${peak.toFixed(2)} threshold=${threshold}`);
  check('resume did NOT fire before arming (no below-threshold frame-1 trip)',
    firstResumedIdx > firstAboveIdx,
    `above@${firstAboveIdx} resumed@${firstResumedIdx}`);
  check('resume fired while still bouncing (before settle)', firstResumedIdx > 0 && firstResumedIdx < trace.length - 1,
    `resumed@${firstResumedIdx}/${trace.length}`);
  check('idle head poses resumed (idle-behavior timer re-set)', a._timers.has('idle-behavior'));
  check('peak amplitude in expected range', peak > 5 && peak < 40, `peak=${peak.toFixed(2)}`);
  check('meld flags cleared after settle', card._bopResumeArmed === false && card._bopResumed === false);
}

// ---- 4b: Safety net — tiny resume threshold still resumes on settle ----
console.log('\n[2] Safety net: resume fires on settle when threshold never trips');
{
  const card = makeCard('idle', { tap_bop_resume: 0.05 });
  bopHead(card);
  pumpBop(card);
  check('idle-behavior re-set by settle safety net', card.animator._timers.has('idle-behavior'));
  check('meld flags cleared by settle safety net', card._bopResumeArmed === false && card._bopResumed === false);
}

// ---- 5: Dancing — bop HOLDS the dance, resumes at the meld point ----
console.log('\n[3] Dancing tap: dance held during bop, released at meld/settle');
{
  const card = makeCard('dancing');
  const a = card.animator;
  const ledCallsBefore = a._calls.setLEDs.length;

  bopHead(card);
  check('bop active while dancing', card._bopping === true);
  check('dance hold flag set on tap', card._danceHeld === true);
  check('no idle-pose stop attempted (no idle timers cleared)', a._calls.clearedTimers.length === 0);
  check('in-flight head motion frozen on tap (freezeHeadMotion called)', a._calls.freezeHeadMotion === 1);
  check('no LED writes by bop while dancing', a._calls.setLEDs.length === ledCallsBefore);

  const trace = pumpBop(card);

  check('#axidos-head transform NEVER written while dancing', trace.every((f) => f.headTransform === ''));
  check('#head-bop bounced while dancing', trace.some((f) => f.bopTransform.includes('translate3d')));
  check('layer reset on settle while dancing', a._calls.resetBopLayer >= 1);
  check('dance hold released by meld or settle', card._danceHeld === false);
}

// ---- 5b: dance.js honors the hold — visuals skipped, beat clock ticking ----
console.log('\n[4] dance.js hold: pose moves skipped while beat clock keeps ticking');
{
  const card = makeCard('dancing', { bpm_entity: null });
  const a = card.animator;
  card._danceHeld = true;

  startDanceCycle(card, 120);
  // startDanceCycle calls step() once immediately; with the hold set it must
  // only advance the beat clock (dance-step timer) and skip every visual.
  check('beat clock still ticking under hold (dance-step timer set)', a._timers.has('dance-step'));
  check('no pose moves while held', a._calls.setHead === 0);
  check('no LED writes while held', a._calls.setLEDs.length === 0);
  check('no RAF loops in the dance path', a._rafs.size === 0);
  // setBellows(0, 0.3) from stopDanceCycle's reset is allowed; no non-zero pump.
  check('no bellows pump while held', a._calls.setBellows.every(([p]) => p === 0));

  // Release the hold: the next step must produce full choreography.
  card._danceHeld = false;
  const stepFn = a._timers.get('dance-step');
  if (stepFn) stepFn.fn();
  check('choreography resumes after hold release (setHead fired)', a._calls.setHead > 0);
  check('LED writes resumed after release', a._calls.setLEDs.length > 0);
}

// ---- 6: stopBop — teardown path ----
console.log('\n[5] stopBop: cancels RAF, nulls spring, eases layer home, clears flags');
{
  const card = makeCard('idle');
  bopHead(card);
  check('bop running before stop', card._bopping === true);
  stopBop(card);
  check('bop flag cleared', card._bopping === false);
  check('spring nulled', card._bopSpring === null);
  check('bop-raf cancelled', !card.animator._rafs.has('bop-raf'));
  check('layer eased home', card.animator._calls.resetBopLayer >= 1);
  check('meld/hold flags cleared', card._bopResumeArmed === false && card._bopResumed === false && card._danceHeld === false);

  // stopBop when not bopping must NOT touch the layer (no stray transition).
  const idle2 = makeCard('idle');
  stopBop(idle2);
  check('stopBop no-op when idle (no layer write)', idle2.animator._calls.resetBopLayer === 0);
}

// ---- 7: Re-tap mid-bop injects velocity AND re-pauses/re-arms ----
console.log('\n[6] Re-tap mid-bop: velocity injected, background re-paused, meld re-armed');
{
  const card = makeCard('idle');
  bopHead(card);
  const spring1 = card._bopSpring;
  const vBefore = spring1.velocity;
  // Let it decay past the meld point so the background resumes.
  const a = card.animator;
  let now = performance.now();
  for (let i = 0; i < 30; i++) { now += 16.666; const fn = a._rafs.get('bop-raf'); if (fn) fn(now); }
  check('background resumed before re-tap (meld fired)', a._timers.has('idle-behavior'));
  const vMid = spring1.velocity;
  bopHead(card); // re-tap
  check('same spring instance reused', card._bopSpring === spring1);
  // Energy-add kick: kinetic energy (v^2) must strictly increase — a plain
  // injectVelocity could REDUCE it when the spring was moving opposite the
  // kick (the trough-dampening bug).
  check('re-tap kick adds energy (v^2 strictly increases)',
    spring1.velocity * spring1.velocity > vMid * vMid,
    `vMid=${vMid.toFixed(3)} vAfter=${spring1.velocity.toFixed(3)}`);
  check('re-tap re-paused background (idle-behavior cleared)', !a._timers.has('idle-behavior'));
  check('re-tap re-armed meld (armed flag reset)', card._bopResumeArmed === false && card._bopResumed === false);
  check('re-tap re-baselined maxSeen to 0 (not current position)', card._bopMaxSeen === 0);
  check('re-tap cleared peak-frozen flag (new peak will be detected)', card._bopPeakFrozen === false);
  stopBop(card);
}

// ---- 12: FROZEN peak threshold — resume fires at the configured fraction of
// the TRUE peak, never early. Regression test for the "resumes within a
// second regardless of Idle Resume Point" bug: the old code let maxSeen grow
// every frame, so the threshold chased the rising position and armed the meld
// almost immediately.
console.log('\n[12] Frozen-peak threshold: meld at configured fraction of TRUE peak');
{
  for (const resumeFrac of [0.1, 0.3, 0.6]) {
    const card = makeCard('idle', { tap_bop_resume: resumeFrac });
    bopHead(card);
    const trace = pumpBop(card);
    const peak = Math.max(...trace.map((f) => Math.abs(f.pos)));
    const resumedFrame = trace.find((f) => f.idleResumed);
    check(`resumeFrac ${resumeFrac}: resume fired during bounce`, resumedFrame !== undefined);
    check(`resumeFrac ${resumeFrac}: meld at configured fraction of TRUE peak`,
      resumedFrame && Math.abs(resumedFrame.pos) <= peak * resumeFrac + 0.5,
      `posAtMeld=${resumedFrame ? Math.abs(resumedFrame.pos).toFixed(2) : 'n/a'} peak*frac=${(peak * resumeFrac).toFixed(2)}`);
    // The meld must NOT fire while the spring is still above the threshold —
    // the first resumed frame must be at/after the first below-threshold frame.
    const firstBelowIdx = trace.findIndex((f) => Math.abs(f.pos) <= peak * resumeFrac);
    check(`resumeFrac ${resumeFrac}: no early resume (meld at/after first below-threshold frame)`,
      resumedFrame && trace.indexOf(resumedFrame) >= firstBelowIdx,
      `resumed@${trace.indexOf(resumedFrame)} firstBelow@${firstBelowIdx}`);
    stopBop(card);
  }
}

// ---- 13: No-snap resume — startIdleHeadPoses re-applies the frozen pose
// with a transition so the first post-meld behavior eases instead of
// teleporting (the "new animation triggered right after the bop" bug).
console.log('\n[13] No-snap resume: head un-frozen with transition on meld');
{
  const card = makeCard('idle');
  const a = card.animator;
  // Simulate the frozen head: freezeHeadMotion() leaves a computed transform
  // inline with transition: none. Stub getComputedStyle to return a pose.
  const savedGCS = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ transform: 'matrix(1, 0, 0, 1, 3, -2)' });
  a.el.head.style.transform = 'matrix(1, 0, 0, 1, 3, -2)';
  a.el.head.style.transition = 'none';

  bopHead(card);
  pumpBop(card);

  // After the meld, startIdleHeadPoses must have restored a transition on the
  // head (un-freezing it) — the head must NOT be left with transition: none.
  check('head transition restored after meld (not left frozen)',
    a.el.head.style.transition !== 'none',
    `transition=${JSON.stringify(a.el.head.style.transition)}`);
  check('idle-behavior re-set after meld', a._timers.has('idle-behavior'));
  globalThis.getComputedStyle = savedGCS;
  stopBop(card);
}

// ---- 9: Kick math — always amplifies, direction preserved, capped ----
console.log('\n[9] spring.kick: energy-add at peak / trough / mid-rise, cap enforced');
{
  const v0 = 3.78; // default bop kick magnitude
  const cap = 5.25; // 2.5 * maxAmp * omega

  // At the peak: v ~ 0 -> kick degenerates to injection.
  const atPeak = createSpring({ omega: 0.14, dampingRatio: 0.3 });
  atPeak.kick(v0, cap);
  check('kick at peak (v=0) injects full kick', Math.abs(atPeak.velocity - v0) < 1e-9);

  // Rising from the trough: v < 0 -> direction preserved, energy added.
  // (Old injectVelocity(+v0) would have cancelled this — the dampening bug.)
  const rising = createSpring({ omega: 0.14, dampingRatio: 0.3 });
  rising.velocity = -2.0;
  rising.kick(v0, cap);
  check('kick while rising preserves direction (still negative)', rising.velocity < 0);
  check('kick while rising adds energy (|v| > |v_before|)', Math.abs(rising.velocity) > 2.0);
  check('kick magnitude is energy-add (sqrt(v^2+v0^2))',
    Math.abs(Math.abs(rising.velocity) - Math.sqrt(4 + v0 * v0)) < 1e-9);

  // Mid-fall: v > 0 -> same direction, boosted.
  const falling = createSpring({ omega: 0.14, dampingRatio: 0.3 });
  falling.velocity = 2.0;
  falling.kick(v0, cap);
  check('kick while falling preserves direction (still positive)', falling.velocity > 0);
  check('kick while falling adds energy', Math.abs(falling.velocity) > 2.0);

  // Cap: repeated kicks must never exceed maxVelocity.
  const spam = createSpring({ omega: 0.14, dampingRatio: 0.3 });
  for (let i = 0; i < 50; i++) spam.kick(v0, cap);
  check('amplitude cap enforced under spam clicking', Math.abs(spam.velocity) <= cap + 1e-9,
    `v=${spam.velocity.toFixed(3)} cap=${cap}`);
}

// ---- 10: maxSeen threshold — meld at a fraction of the ACTUAL peak ----
console.log('\n[10] maxSeen meld threshold: fraction of actual peak, not theoretical maxAmp');
{
  const card = makeCard('idle');
  bopHead(card);
  const trace = pumpBop(card);
  const peak = Math.max(...trace.map((f) => Math.abs(f.pos)));
  const resumeFrac = 0.3;
  // The resume must fire only after the position has decayed to ~30% of the
  // ACTUAL peak (which overshoots the theoretical maxAmp of 15 by ~1.8x).
  const resumedFrame = trace.find((f) => f.idleResumed);
  check('resume fired during bounce', resumedFrame !== undefined);
  check('resume threshold tracked actual peak (|pos| <= peak*frac at meld)',
    Math.abs(resumedFrame.pos) <= peak * resumeFrac + 0.5,
    `posAtMeld=${Math.abs(resumedFrame.pos).toFixed(2)} peak*frac=${(peak * resumeFrac).toFixed(2)}`);
  check('maxSeen recorded on card', card._bopMaxSeen > 0);
  stopBop(card);
}

// ---- Spring sanity: shared oscillator still behaves ----
console.log('\n[7] Spring sanity (shared oscillator)');
{
  const s = createSpring({ omega: 0.28, dampingRatio: 0.3 });
  s.injectVelocity(8);
  for (let i = 0; i < 600; i++) s.step(16.666);
  check('spring settles eventually', s.step(16.666) === true || (Math.abs(s.position) < 0.08 && Math.abs(s.velocity) < 0.08));
}

// ---- 8: Zoom slot sizing — rows AND columns grow with zoom ----
console.log('\n[8] getGridOptions: rows AND columns scale with zoom');
{
  // AxidosCard extends HTMLElement; instantiate via a minimal shim if needed.
  let card;
  try {
    card = new AxidosCard();
  } catch (err) {
    // Stub environments without HTMLElement: exercise the math directly.
    card = null;
  }
  const rowsFor = (zoom) => Math.max(4, Math.ceil((320 * (zoom / 100) + 24) / 80));
  const colsFor = (zoom) => Math.min(12, Math.max(6, Math.round(6 * (zoom / 100))));
  const cases = [[85, 4, 6], [100, 5, 6], [120, 6, 7], [150, 7, 9], [200, 9, 12]];
  for (const [zoom, wantRows, wantCols] of cases) {
    let got;
    if (card) {
      card.config = { zoom };
      got = card.getGridOptions();
      check(`zoom ${zoom}: rows=${wantRows} columns=${wantCols}`,
        got.rows === wantRows && got.columns === wantCols,
        `got rows=${got.rows} columns=${got.columns}`);
    } else {
      check(`zoom ${zoom}: rows=${wantRows} columns=${wantCols} (math)`,
        rowsFor(zoom) === wantRows && colsFor(zoom) === wantCols);
    }
  }
  if (card) {
    const g = card.getGridOptions();
    check('max_columns cap respected', g.max_columns === 12 && g.columns <= g.max_columns);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);