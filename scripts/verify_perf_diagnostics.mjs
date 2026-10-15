/**
 * verify_perf_diagnostics.mjs — Verification of the 5.8.0 tablet-smoothness
 * work: opt-in perf HUD, beat-grid phase preservation, setPupil write guard,
 * and the timer-based lid loop. Extended for 5.7.0-beta.1: version echo,
 * debug_lite/debug_dprfix flags, the dprFixStyles contract, and the
 * #scene positioning guard the workaround depends on.
 *
 * Sections:
 *  1. Config: debug_perf sanitization (default OFF, strict === true).
 *  2. PerfMonitor: beat-lateness rolling window (32 samples), HUD render
 *     content, destroy() cleanup.
 *  3. Beat-grid phase preservation: a late tick must NOT re-anchor the grid
 *     to `now` — expectedNextTick advances in whole-beat steps so poses stay
 *     locked to the music's beat positions (the "skips a beat and
 *     fast-forwards" fix). A fully-missed beat is skipped without
 *     displacing the phase of the following beats.
 *  4. setPupil redundant-write guard: identical targets skip the 3-element
 *     write cascade; changed targets write.
 *  5. Lid loop: timer-scheduled (no RAF chain) — startLidBehavior registers
 *     a 'lid-loop' TIMER, not a RAF, and stopLidBehavior clears it.
 *  6. 5.7.0-beta.1: new debug flags sanitize (default OFF, strict === true).
 *  7. 5.7.0-beta.1: dprFixStyles contract — dpr 1 → null (structural
 *     no-op), dpr 2 → exact workaround styles with top-left pinning,
 *     invalid input → null.
 *  8. 5.7.0-beta.1: template gating — debug-lite class present/absent,
 *     freeze rules target the sway pivots, #scene keeps position: relative
 *     (the containing block the dprfix pin depends on), HUD echoes the
 *     build version + resolved flags line.
 *  9. 5.7.0-beta.2 blocker fix: the debug-lite class must be a class
 *     ATTRIBUTE on #scene, never part of the id (beta.1 emitted
 *     <div id="scene debug-lite">, which matched no #scene CSS rule —
 *     #scene lost position: relative and #hitbox's inset: 0 fell back to
 *     the viewport = full-dashboard click interception). Asserts the exact
 *     id token + hitbox containment under EVERY flag combination.
 * 10. 5.7.0-beta.2 HUD v2.1: Δheap/min slope — least-squares over a
 *     rolling 60s window, rendered on the heap line.
 */

import { sanitizeConfig } from '../src/config.js';
import { buildTemplate, dprFixStyles } from '../src/template.js';
import { CARD_VERSION } from '../src/version.js';
import { PerfMonitor } from '../src/perf.js';
import { startDanceCycle, stopDanceCycle } from '../src/behaviors/dance.js';
import { startLidBehavior, stopLidBehavior } from '../src/behaviors/idle.js';

let failures = 0;
let passed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log(`  PASS  ${msg}`); }
  else { failures++; console.error(`  FAIL  ${msg}`); }
};

// ---- Minimal DOM/animator stubs (mirror the other suites) ----
function makeEl() {
  return {
    style: {},
    attrs: {},
    _writes: 0,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  };
}
// Style-write counting proxy: counts transform assignments on pupil/eyeball.
function makeCountingEl() {
  const el = makeEl();
  let writes = 0;
  Object.defineProperty(el.style, 'transform', {
    set() { writes++; },
    get() { return ''; },
  });
  el._writeCount = () => writes;
  return el;
}

function makeAnimator() {
  const el = {};
  for (const k of ['svg', 'head', 'headBop', 'torsoSwivel', 'hitbox', 'eyeHalo', 'eyeCenter', 'bellows', 'lidTop', 'lidBot', 'dangerRing']) el[k] = makeEl();
  el.pupil = makeCountingEl();
  el.eyeball = makeCountingEl();
  el.ledMatrices = [];
  const a = {
    el,
    currentBaseLid: 0,
    currentLedColor: '#ffb800',
    currentLedOpacity: '0.15',
    _timers: new Map(),
    _rafs: new Map(),
    setTimeout(name, fn, delay) { this._timers.set(name, { fn, delay }); return name; },
    clearTimeout(name) { this._timers.delete(name); },
    requestRaf(name, fn) { this._rafs.set(name, fn); return name; },
    cancelRaf(name) { this._rafs.delete(name); },
    setHead() {},
    resetBodySwivel() {},
    setBodySwivel() {},
    setLid() {},
    setBaseLid(v) { this.currentBaseLid = v; },
    setPupil(px, py) {
      // Mirror the PRODUCTION guard contract under test (section 4 drives
      // the real animator separately; this stub is for the dance cycle).
      if (px === this._lastPx && py === this._lastPy) return;
      this._lastPx = px; this._lastPy = py;
      el.pupil.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    },
    setBellows() {},
    setLEDs() {},
    setLedVars() {},
    stopAll() { this._timers.clear(); this._rafs.clear(); },
  };
  return a;
}

function makeCard() {
  return { animator: makeAnimator(), _state: 'dancing', config: {}, perf: null };
}

// ---- Fake clock: drive performance.now() so late ticks are simulatable ----
let fakeTime = 0;
const realNow = performance.now.bind(performance);
performance.now = () => fakeTime;

// ============================================================
console.log('\n== 1. Config: debug_perf sanitization ==');
{
  const c1 = sanitizeConfig({ entity: 'x' });
  assert(c1.debug_perf === false, 'default debug_perf is false (absent key)');
  const c2 = sanitizeConfig({ entity: 'x', debug_perf: true });
  assert(c2.debug_perf === true, 'debug_perf: true survives sanitization');
  const c3 = sanitizeConfig({ entity: 'x', debug_perf: 'yes' });
  assert(c3.debug_perf === false, 'debug_perf: non-boolean truthy is coerced OFF (strict === true)');
  const c4 = sanitizeConfig({ entity: 'x', debug_perf: false });
  assert(c4.debug_perf === false, 'debug_perf: false stays false');
}

// ============================================================
console.log('\n== 2. PerfMonitor: lateness window + HUD + destroy ==');
{
  // Minimal ShadowRoot stub: appendChild + getElementById not needed by the
  // monitor (it only appends the HUD div and reads it back).
  const hudEl = {
    style: {}, attrs: {}, _text: '',
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    setAttribute(k, v) { this.attrs[k] = v; },
    setAttributeNS() {},
    className: '',
    parentNode: { removeChild() {} },
  };
  const shadow = {
    _children: [],
    appendChild(c) { this._children.push(c); return c; },
  };
  // PerfMonitor uses document.createElement — stub it for Node (no DOM).
  const realCreate = globalThis.document?.createElement?.bind(globalThis.document);
  globalThis.document = { createElement: () => hudEl };
  // rAF stub: never fires (we only test registration/cleanup).
  const realRaf = globalThis.requestAnimationFrame;
  const realCaf = globalThis.cancelAnimationFrame;
  let rafId = 0;
  globalThis.requestAnimationFrame = () => ++rafId;
  globalThis.cancelAnimationFrame = () => {};

  let mon = null;
  try {
    mon = new PerfMonitor(shadow);
    assert(shadow._children.length === 1, 'HUD element appended to shadow root');

    // Rolling window: push 40 samples, only the last 32 are kept.
    for (let i = 1; i <= 40; i++) mon.recordBeatLateness(i);
    assert(mon._beatLates.length === 32, `lateness window capped at 32 (got ${mon._beatLates.length})`);
    assert(mon._beatLates[0] === 9 && mon._beatLates[31] === 40, 'window keeps the MOST RECENT samples (9..40)');

    // Non-finite input ignored; negative clamped to 0. The window is capped
    // at 32, so the new sample shifts out the oldest (9) — length stays 32.
    mon.recordBeatLateness(NaN);
    mon.recordBeatLateness(Infinity);
    mon.recordBeatLateness(-5); // clamped to 0
    assert(mon._beatLates.length === 32, 'NaN/Infinity rejected, window stays capped at 32');
    assert(mon._beatLates[0] === 10 && mon._beatLates[31] === 0, 'negative lateness clamped to 0, oldest sample shifted out');

    // HUD render: force a refresh and check content shape.
    mon._renderHud();
    const txt = mon._hud.textContent;
    assert(/fps: \d+/.test(txt), `HUD shows fps (${txt.split('\n')[0]})`);
    assert(/beat late: \d+\/\d+\/\d+ ms/.test(txt), `HUD shows beat lateness min/avg/max (${txt.split('\n')[1]})`);

    // Destroy: removes HUD, clears timers/RAF.
    mon.destroy();
    assert(mon._hud === null, 'destroy() clears the HUD reference');
    assert(mon._rafId === null && mon._hudTimer === null, 'destroy() clears sampler + interval');
  } finally {
    if (realCreate) globalThis.document.createElement = realCreate;
    else delete globalThis.document;
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
  }
}

// ============================================================
console.log('\n== 3. Beat-grid phase preservation (late-tick simulation) ==');
{
  // Drive the REAL dance engine with a fake clock. Fire the step timer
  // LATE (past the scheduled slot) and assert the grid advances in whole
  // beats — the next tick's delay must stay within (0, beatMs] and the
  // grid must never re-anchor to `now` (which would fast-forward the
  // following pose).
  const card = makeCard();
  const BPM = 180;                 // 333ms beat — the tablet pain zone
  const beatMs = 60000 / BPM;
  startDanceCycle(card, BPM);

  // Tick 1 fires on time at t=0 (startDanceCycle's synchronous step()).
  // executeTick schedules the next tick at expectedNextTick = 0 + beatMs.
  let t = card.animator._timers.get('dance-step');
  assert(t && Math.abs(t.delay - beatMs) < 1, `tick 2 scheduled one beat out (${t.delay.toFixed(1)}ms ≈ ${beatMs.toFixed(1)}ms)`);

  // Tick 2 fires 120ms LATE (main-thread contention simulation).
  fakeTime = beatMs + 120;
  card.animator._timers.delete('dance-step');
  t.fn();
  t = card.animator._timers.get('dance-step');
  // Old behavior: grid re-anchored to now → next tick at now+beatMs
  // (2*beatMs+120) — the pose grid SHIFTED by the lateness. New behavior:
  // grid advances in whole beats → next tick at 2*beatMs, i.e. delay
  // beatMs-120. The grid stays locked to the music's beat positions.
  assert(t && Math.abs(t.delay - (beatMs - 120)) < 1,
    `late tick keeps the grid on the music (next delay ${t.delay.toFixed(1)}ms ≈ ${(beatMs - 120).toFixed(1)}ms, not a re-anchor)`);

  // Tick 3 fires SO late the beat was fully missed (2.5 beats late).
  fakeTime = 2 * beatMs + beatMs * 2.5;
  card.animator._timers.delete('dance-step');
  t.fn();
  t = card.animator._timers.get('dance-step');
  // Grid must advance to the next whole-beat slot AFTER now, never to now
  // itself: delay must be in (0, beatMs].
  assert(t && t.delay > 0 && t.delay <= beatMs + 1,
    `fully-missed beat skipped without phase displacement (next delay ${t.delay.toFixed(1)}ms in (0, ${beatMs.toFixed(1)}ms])`);

  // Grid monotonicity: after N late ticks the scheduled slot is always a
  // whole-beat multiple (within 1ms float tolerance).
  const slot = fakeTime + t.delay;
  const k = Math.round(slot / beatMs);
  assert(Math.abs(slot - k * beatMs) < 1, `scheduled slot is grid-aligned (${slot.toFixed(1)}ms ≈ beat ${k})`);

  stopDanceCycle(card);
  performance.now = realNow;
}

// ============================================================
console.log('\n== 4. setPupil redundant-write guard ==');
{
  // Drive the REAL animator's guard contract: identical targets skip the
  // pupil/eyeball writes, changed targets write. (The production animator
  // is constructed from a shadow root; here we exercise the guard logic
  // through a minimal instance mirroring animator.js's setPupil.)
  const a = makeAnimator();
  // Simulate the production guard by importing the real class shape:
  // construct AxidosAnimator against a stub shadowRoot.
  const { AxidosAnimator } = await import('../src/animator.js');
  const els = {
    'axidos-svg': makeEl(), 'axidos-head': makeEl(), 'head-bop': makeEl(),
    'torso-swivel': makeEl(), hitbox: makeEl(), 'eye-layer-idle': makeEl(),
    'eye-layer-listen': makeEl(), 'eye-layer-process': makeEl(),
    'eye-layer-respond': makeEl(), 'eye-layer-dance': makeEl(),
    'eye-halo': makeEl(), 'eye-center': makeEl(), 'eye-pupil': makeCountingEl(),
    'eyeball-assembly': makeCountingEl(), bellows: makeEl(),
    'eye-lid': makeEl(), 'eye-lid-bottom': makeEl(),
    'danger-ring': makeEl(), 'progress-ring': makeEl(),
    'ind-l1': makeEl(), 'ind-l2': makeEl(), 'ind-r1': makeEl(), 'ind-r2': makeEl(),
  };
  const shadow = {
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
  };
  const anim = new AxidosAnimator(shadow);
  anim.setPupil(3, -2);
  const w1 = els['eye-pupil']._writeCount() + els['eyeball-assembly']._writeCount();
  anim.setPupil(3, -2); // identical target
  const w2 = els['eye-pupil']._writeCount() + els['eyeball-assembly']._writeCount();
  assert(w2 === w1, `identical pupil target skips the write cascade (${w2} writes after repeat call, expected ${w1})`);
  anim.setPupil(-4, 1); // changed target
  const w3 = els['eye-pupil']._writeCount() + els['eyeball-assembly']._writeCount();
  assert(w3 > w2, `changed pupil target writes (${w3} > ${w2})`);
  anim.setPupil(-4, 1); // repeat again
  const w4 = els['eye-pupil']._writeCount() + els['eyeball-assembly']._writeCount();
  assert(w4 === w3, `second identical call also skipped (${w4} === ${w3})`);
}

// ============================================================
console.log('\n== 5. Lid loop: timer-scheduled, no RAF chain ==');
{
  const card = makeCard();
  card._state = 'idle';
  startLidBehavior(card);
  assert(card.animator._timers.has('lid-loop'), 'lid loop registers a TIMER (fires only when a lid change is due)');
  assert(!card.animator._rafs.has('lid-loop'), 'lid loop registers NO RAF (no per-frame main-thread wakeups)');
  const t = card.animator._timers.get('lid-loop');
  assert(t.delay === 0, 'first lid tick fires immediately (loop bootstrap)');

  // State exit: a non-idle/processing state stops the chain.
  card._state = 'dancing';
  card.animator._timers.delete('lid-loop');
  t.fn();
  assert(!card.animator._timers.has('lid-loop'), 'lid tick on a foreign state exits without rescheduling');

  // Processing state reschedules with the short processing cadence.
  card._state = 'processing';
  startLidBehavior(card);
  const t2 = card.animator._timers.get('lid-loop');
  card.animator._timers.delete('lid-loop');
  t2.fn();
  const t3 = card.animator._timers.get('lid-loop');
  assert(t3 && t3.delay >= 120 && t3.delay <= 400, `processing lid cadence 120-400ms (got ${t3.delay.toFixed(0)}ms)`);

  stopLidBehavior(card);
  assert(!card.animator._timers.has('lid-loop'), 'stopLidBehavior clears the timer');
}

// ============================================================
console.log('\n== 6. 5.7.0-beta.1: debug_lite + debug_dprfix sanitization ==');
{
  const c1 = sanitizeConfig({ entity: 'x' });
  assert(c1.debug_lite === false && c1.debug_dprfix === false, 'new debug flags default OFF (absent keys)');
  const c2 = sanitizeConfig({ entity: 'x', debug_lite: true, debug_dprfix: true });
  assert(c2.debug_lite === true && c2.debug_dprfix === true, 'debug_lite/debug_dprfix: true survive sanitization');
  const c3 = sanitizeConfig({ entity: 'x', debug_lite: 'yes', debug_dprfix: 1 });
  assert(c3.debug_lite === false && c3.debug_dprfix === false, 'non-boolean truthy coerced OFF (strict === true)');
  const c4 = sanitizeConfig({ entity: 'x', debug_lite: false, debug_dprfix: false });
  assert(c4.debug_lite === false && c4.debug_dprfix === false, 'explicit false stays false');
}

// ============================================================
console.log('\n== 7. 5.7.0-beta.1: dprFixStyles contract ==');
{
  // DSF == 1 → structural no-op: null, so the caller injects NOTHING and
  // the non-probe path stays byte-identical.
  assert(dprFixStyles(1) === null, 'dpr 1 → null (structural no-op, nothing injected)');
  // DSF 2 → the exact crbug 449095626 workaround + top-left pinning.
  const s2 = dprFixStyles(2);
  assert(s2 !== null, 'dpr 2 → styles returned');
  assert(s2.includes('transform: scale(2)'), 'dpr 2 → transform: scale(2)');
  assert(s2.includes('transform-origin: 0 0'), 'dpr 2 → transform-origin: 0 0 (as cited)');
  assert(s2.includes('width: 50%') && s2.includes('height: 50%'), 'dpr 2 → width/height 100/dpr % (50%)');
  assert(s2.includes('position: absolute') && s2.includes('top: 0') && s2.includes('left: 0'),
    'dpr 2 → top-left pinned (neutralizes the #scene flex-center shift)');
  // Fractional DSF (the Tab S6 Lite reports 2.0, but desktop zoom can give
  // e.g. 1.25): size-neutral math must hold.
  const s125 = dprFixStyles(1.25);
  assert(s125 !== null && s125.includes('transform: scale(1.25)') && s125.includes('width: 80%'),
    'dpr 1.25 → scale(1.25) + width 80% (100/1.25)');
  // Invalid input → null (caller must not inject garbage).
  assert(dprFixStyles(0) === null, 'dpr 0 → null');
  assert(dprFixStyles(-2) === null, 'dpr negative → null');
  assert(dprFixStyles(NaN) === null, 'dpr NaN → null');
  assert(dprFixStyles(Infinity) === null, 'dpr Infinity → null');
  assert(dprFixStyles('2') === null, 'dpr string → null');
  assert(dprFixStyles(undefined) === null, 'dpr undefined → null');
}

// ============================================================
console.log('\n== 8. 5.7.0-beta.1: template gating + scene guard + HUD build/flags ==');
{
  // debug_lite OFF (default): no freeze class, no freeze rules.
  const tOff = buildTemplate({ zoom: 85 });
  assert(!tOff.includes('debug-lite'), 'debug_lite off → no debug-lite class in template');
  assert(!tOff.includes('animation: none'), 'debug_lite off → no freeze rules in template');
  // debug_lite ON: class ATTRIBUTE on #scene + freeze rules for both sway
  // pivots. (5.7.0-beta.2 fix: beta.1 emitted <div id="scene debug-lite"> —
  // the class was interpolated INTO the id, which broke every #scene rule.)
  const tOn = buildTemplate({ zoom: 85, debug_lite: true });
  assert(tOn.includes('<div id="scene" class="debug-lite">'), 'debug_lite on → debug-lite as a class ATTRIBUTE on #scene (id stays "scene")');
  assert(tOn.includes('.debug-lite #body-pivot') && tOn.includes('.debug-lite #head-sway-pivot'),
    'debug_lite on → freeze rules target both sway pivots');
  assert(tOn.includes('.debug-lite #eye-halo.breathing'), 'debug_lite on → breathing selector frozen (future-proofing)');
  // #scene positioning guard: the dprfix top-left pin depends on #scene
  // being the containing block (position: relative). If this ever changes,
  // the workaround's pin silently anchors to the wrong ancestor.
  assert(tOff.includes('#scene { position: relative;'), '#scene keeps position: relative (dprfix pin containing block)');
  // HUD: build version echo + resolved flags line.
  const hudEl = {
    style: {}, attrs: {}, _text: '',
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    setAttribute(k, v) { this.attrs[k] = v; },
    setAttributeNS() {},
    className: '',
    parentNode: { removeChild() {} },
  };
  const shadow = { _children: [], appendChild(c) { this._children.push(c); return c; } };
  const realCreate = globalThis.document?.createElement?.bind(globalThis.document);
  globalThis.document = { createElement: () => hudEl };
  const realRaf = globalThis.requestAnimationFrame;
  const realCaf = globalThis.cancelAnimationFrame;
  let rafId = 0;
  globalThis.requestAnimationFrame = () => ++rafId;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const mon = new PerfMonitor(shadow, { debug_perf: true, debug_lite: true, debug_dprfix: true });
    mon._renderHud();
    const txt = mon._hud.textContent;
    assert(txt.includes(`build: ${CARD_VERSION}`), `HUD echoes the build version (${CARD_VERSION})`);
    assert(CARD_VERSION === '5.7.0-beta.2', `version.js is the beta build (${CARD_VERSION})`);
    assert(/dpr: \d/.test(txt), 'HUD shows live dpr');
    assert(txt.includes('flags: perf on · lite on · dprfix: on'), 'HUD flags line shows resolved flags');
    assert(txt.includes('heap:'), 'HUD shows heap line (n/a or MB)');
    mon.destroy();
    // DSF-1 resolution: dprfix on at dpr 1 must read "identity" so a DSF-1
    // tester does not file a false regression.
    globalThis.devicePixelRatio = 1;
    const mon2 = new PerfMonitor(shadow, { debug_perf: true, debug_dprfix: true });
    mon2._renderHud();
    assert(mon2._hud.textContent.includes('dprfix: on (identity, dpr 1)'),
      'HUD resolves dprfix at DSF 1 as "on (identity, dpr 1)"');
    mon2.destroy();
    delete globalThis.devicePixelRatio;
  } finally {
    if (realCreate) globalThis.document.createElement = realCreate;
    else delete globalThis.document;
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
  }
}

// ============================================================
console.log('\n== 9. 5.7.0-beta.2 blocker: #scene id token + hitbox containment under ALL flag combos ==');
{
  // The soft-lock: with debug_lite on, beta.1 rendered <div id="scene
  // debug-lite"> — the id no longer matched #scene CSS, position: relative
  // dropped, and #hitbox (position: absolute; inset: 0; z-index: 100) fell
  // back to the viewport, intercepting clicks across the whole dashboard.
  // These checks pin the invariant under every flag combination.
  const combos = [
    {},
    { debug_lite: true },
    { debug_perf: true },
    { debug_dprfix: true },
    { debug_lite: true, debug_perf: true },
    { debug_lite: true, debug_dprfix: true },
    { debug_perf: true, debug_dprfix: true },
    { debug_lite: true, debug_perf: true, debug_dprfix: true },
  ];
  for (const cfg of combos) {
    const t = buildTemplate({ zoom: 85, ...cfg });
    const label = Object.keys(cfg).length ? Object.keys(cfg).join('+') : 'defaults';
    // The id attribute must be EXACTLY "scene" — a single token, no class
    // text glued onto it (the class lives in its own attribute).
    assert(t.includes('<div id="scene"'), `[${label}] #scene id is the exact token "scene"`);
    assert(!t.includes('id="scene '), `[${label}] no class text glued into the #scene id`);
    // Structural containment: #hitbox opens after #scene and the scene div
    // closes after the SVG — the hitbox is a child of #scene, so its
    // inset: 0 resolves against #scene's position: relative box.
    const idxScene = t.indexOf('<div id="scene"');
    const idxHitbox = t.indexOf('id="hitbox"');
    const idxSvgClose = t.indexOf('</svg>');
    const idxSceneClose = t.lastIndexOf('</div>');
    assert(idxScene !== -1 && idxHitbox > idxScene && idxSvgClose > idxHitbox && idxSceneClose > idxSvgClose,
      `[${label}] #hitbox is nested inside #scene (containing block for inset: 0)`);
    // The containing block the hitbox (and the dprfix pin) depend on.
    assert(t.includes('#scene { position: relative;'), `[${label}] #scene keeps position: relative`);
  }
}

// ============================================================
console.log('\n== 10. 5.7.0-beta.2 HUD v2.1: Δheap/min slope ==');
{
  const hudEl = {
    style: {}, attrs: {}, _text: '',
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; },
    setAttribute(k, v) { this.attrs[k] = v; },
    setAttributeNS() {},
    className: '',
    parentNode: { removeChild() {} },
  };
  const shadow = { _children: [], appendChild(c) { this._children.push(c); return c; } };
  const realCreate = globalThis.document?.createElement?.bind(globalThis.document);
  globalThis.document = { createElement: () => hudEl };
  const realRaf = globalThis.requestAnimationFrame;
  const realCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  // Stub performance.memory with a controlled ramp: +5 MB per 500ms sample
  // → +10 MB/min expected slope. Stub performance.now to drive sample times.
  const realNow = performance.now.bind(performance);
  const realMem = performance.memory;
  let fakeT = 0;
  performance.now = () => fakeT;
  const MB = 1048576;
  performance.memory = { usedJSHeapSize: 200 * MB };
  try {
    const mon = new PerfMonitor(shadow, { debug_perf: true });
    // < 2 samples → slope undefined (no readout yet).
    mon._renderHud();
    assert(mon._heapSlope() === null, 'slope undefined with a single sample');
    assert(!mon._hud.textContent.includes('/min)'), 'no slope readout with a single sample');
    // Leak ramp: 5 samples × 500ms × +0.5 MB → +60 MB/min (1 MB/s).
    for (let i = 1; i <= 4; i++) {
      fakeT += 500;
      performance.memory.usedJSHeapSize += 0.5 * MB;
      mon._renderHud();
    }
    const slope = mon._heapSlope();
    assert(slope !== null && Math.abs(slope - 60) < 0.01, `leak ramp → +60 MB/min (got ${slope?.toFixed(2)})`);
    assert(mon._hud.textContent.includes('heap: 202.0 MB (+60.0/min)'),
      `HUD renders the slope readout (${mon._hud.textContent.split('\n')[1]})`);
    // GC seesaw → slope ≈ 0. Reset the buffer first so the ramp samples
    // don't skew the plateau slope. The sawtooth must be least-squares
    // SYMMETRIC (odd count, same value first and last) or the peak/x
    // correlation itself produces a spurious slope.
    mon._heapSamples = [];
    for (let i = 0; i < 5; i++) {
      fakeT += 500;
      performance.memory.usedJSHeapSize += (i % 2 === 0 ? 2 : -2) * MB; // +2,-2,+2,-2,+2
      mon._renderHud();
    }
    const flat = mon._heapSlope();
    assert(Math.abs(flat) < 0.001, `symmetric sawtooth → slope ≈ 0 (got ${flat?.toFixed(3)} MB/min)`);
    // Window cap: 120 samples max.
    for (let i = 0; i < 200; i++) { fakeT += 500; mon._renderHud(); }
    assert(mon._heapSamples.length === 120, `heap window capped at 120 samples (60s) (got ${mon._heapSamples.length})`);
    mon.destroy();
    // No performance.memory → slope null, heap n/a (non-Chromium guard).
    delete performance.memory;
    const mon2 = new PerfMonitor(shadow, { debug_perf: true });
    mon2._renderHud();
    assert(mon2._heapSlope() === null, 'slope null without performance.memory');
    assert(mon2._hud.textContent.includes('heap: n/a'), 'heap reads n/a without performance.memory');
    mon2.destroy();
  } finally {
    if (realMem) performance.memory = realMem;
    performance.now = realNow;
    if (realCreate) globalThis.document.createElement = realCreate;
    else delete globalThis.document;
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
  }
}

// ============================================================
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('ALL CHECKS PASSED');