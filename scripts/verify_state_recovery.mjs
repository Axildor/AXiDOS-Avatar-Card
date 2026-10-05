/**
 * verify_state_recovery.mjs — verification of the stuck-state recovery
 * contract added in 5.6.1.
 *
 * Covers (all driven through the REAL production pipeline applyHassUpdate):
 *   1. Firehose gate + self-healing sync check:
 *      - identical delivery with synced state → gated (returns false)
 *      - desynced card (caches say idle, _state says responding) → heals on
 *        the next delivery (the stuck-responding bug)
 *      - exception during applyState → _state stays stale, next delivery
 *        re-applies and heals
 *   2. respond_delay timer leak guard:
 *      - deferred responding transition scheduled via 'respond-delay'
 *      - entity leaves responding while pending → timer cleared, never fires
 *      - normal deferred transition still works (fires after the delay)
 *   3. connectedCallback cache reset:
 *      - stale caches are cleared so the next delivery re-evaluates
 */

import { applyHassUpdate } from '../src/hass-update.js';
import { resolveState } from '../src/state-mapper.js';

// Node has no rAF; idle.js schedules the lid loop through animator.requestRaf.
// A setTimeout-based polyfill is sufficient for the mock animator. The timer
// is unref'd so the perpetual lid-loop rAF chain does not hold the event loop
// open after the suite finishes.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (fn) => {
    const id = setTimeout(() => fn(Date.now()), 16);
    if (typeof id.unref === 'function') id.unref();
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('verify_state_recovery — stuck-state healing + timer leak guard\n');

// ── Mock infrastructure ─────────────────────────────────────────────────

/** Fake element: records style writes + setAttribute, no-ops transitions. */
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

/**
 * Mock animator: real timer registry semantics (setTimeout/clearTimeout/
 * stopAll) with injectable clock, plus the element refs applyStateVisuals
 * touches. setHead/setLid/etc. are recording no-ops.
 */
function mockAnimator() {
  const timers = new Map();
  let nextId = 1;
  const a = {
    el: {
      svg: fakeEl(),
      head: fakeEl(),
      headBop: fakeEl(),
      torsoSwivel: fakeEl(),
      hitbox: fakeEl(),
      eyeLayerIdle: fakeEl(),
      eyeLayerListen: fakeEl(),
      eyeLayerProcess: fakeEl(),
      eyeLayerRespond: fakeEl(),
      eyeLayerDance: fakeEl(),
      eyeHalo: fakeEl(),
      eyeCenter: fakeEl(),
      pupil: fakeEl(),
      eyeball: fakeEl(),
      bellows: fakeEl(),
      lidTop: fakeEl(),
      lidBot: fakeEl(),
      dangerRing: fakeEl(),
      progressRing: fakeEl(),
      ledMatrices: [fakeEl(), fakeEl()],
    },
    ledVarTargets: [],
    currentBaseLid: 0,
    _timers: timers,
    clearedTimers: [],
    setTimeout(name, fn, delay) {
      if (timers.has(name)) clearTimeout(timers.get(name).id);
      const entry = { fn, delay, fired: false };
      entry.id = setTimeout(() => { entry.fired = true; timers.delete(name); fn(); }, delay);
      // Behavior loops (talk-step, idle cycle) reschedule themselves forever —
      // unref so they never hold the event loop open after the suite ends.
      if (typeof entry.id.unref === 'function') entry.id.unref();
      timers.set(name, entry);
      return entry.id;
    },
    clearTimeout(name) {
      const entry = timers.get(name);
      if (entry !== undefined) {
        clearTimeout(entry.id);
        timers.delete(name);
        a.clearedTimers.push(name);
      }
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
    _rafs: new Map(),
    stopAll() {
      for (const entry of timers.values()) clearTimeout(entry.id);
      for (const id of a._rafs.values()) cancelAnimationFrame(id);
      timers.clear();
      a._rafs.clear();
    },
    setHead() {}, setBodySwivel() {}, resetBodySwivel() {},
    setLid() {}, setBaseLid() {}, setPupil() {}, setBellows() {},
    setLEDs() {}, setLedVars() {}, freezeHeadMotion() {}, resetBopLayer() {},
  };
  return a;
}

/** Mock card matching AxidosCard's constructor state + config. */
function mockCard(config) {
  return {
    config,
    _hass: null,
    contentReady: true,
    _lastHassVoice: null,
    _lastHassMedia: null,
    _lastHassBpm: null,
    _lastHassProgress: null,
    _progressPct: null,
    _state: 'idle',
    _currentBpm: 120,
    _bopping: false,
    _bopSpring: null,
    animator: mockAnimator(),
    setupDOM() {},
    initAxidos() {},
  };
}

/** Build a hass object with the given entity states. */
function hass({ voice = 'idle', media = 'paused', bpm = '120', progress = null } = {}) {
  const states = {};
  if (voice !== null) states['assist_satellite.x'] = { state: voice };
  if (media !== null) states['media_player.x'] = { state: media };
  if (bpm !== null) states['sensor.bpm'] = { state: bpm };
  if (progress !== null) states['sensor.progress'] = { state: progress };
  return { states };
}

const BASE_CONFIG = {
  entity: 'assist_satellite.x',
  media_entity: 'media_player.x',
  bpm_entity: 'sensor.bpm',
  progress_entity: 'sensor.progress',
  respond_delay: 0,
  progress_min: 0,
  progress_max: 100,
  progress_show_in_dance: true,
};

// ── 1. Firehose gate + self-healing sync check ──────────────────────────
console.log('1. Firehose gate + self-healing sync check');

// Identical delivery with synced state → gated
let card = mockCard(BASE_CONFIG);
applyHassUpdate(card, hass({ voice: 'idle' }));
check('first delivery applies idle', card._state === 'idle');
const gated = applyHassUpdate(card, hass({ voice: 'idle' }));
check('identical delivery gated (returns false)', gated === false);
check('identical delivery keeps state', card._state === 'idle');

// THE BUG: desynced card — caches say idle, _state says responding.
// Before the fix, the firehose gate returned early forever and the card
// stayed stuck in responding visuals until a page refresh.
card = mockCard(BASE_CONFIG);
applyHassUpdate(card, hass({ voice: 'responding' }));
check('responding applied', card._state === 'responding');
// Simulate the desync: a mid-apply exception left the caches at 'idle'
// while _state stayed 'responding'.
card._lastHassVoice = 'idle';
card._state = 'responding';
const healed = applyHassUpdate(card, hass({ voice: 'idle' }));
check('desynced delivery NOT gated (heals)', healed === true);
check('desync healed: state back to idle', card._state === 'idle');

// Desync in the other direction: caches say responding, _state says idle
card = mockCard(BASE_CONFIG);
applyHassUpdate(card, hass({ voice: 'responding' }));
card._lastHassVoice = 'responding';
card._state = 'idle';
applyHassUpdate(card, hass({ voice: 'responding' }));
check('reverse desync healed: state responding', card._state === 'responding');

// Exception during applyState → next delivery heals
card = mockCard(BASE_CONFIG);
applyHassUpdate(card, hass({ voice: 'idle' }));
// Make the NEXT applyState throw (corrupt the animator mid-flight)
const realSetHead = card.animator.setHead;
let threw = false;
card.animator.setHead = () => { throw new Error('boom'); };
applyHassUpdate(card, hass({ voice: 'responding' }));
threw = card._state !== 'responding'; // apply failed → state stale
check('exception during apply leaves state stale', threw);
card.animator.setHead = realSetHead;
applyHassUpdate(card, hass({ voice: 'responding' }));
check('next delivery heals after exception', card._state === 'responding');

// ── 2. respond_delay timer leak guard ───────────────────────────────────
console.log('\n2. respond_delay timer leak guard');

// Normal deferred transition: responding fires after the delay
card = mockCard({ ...BASE_CONFIG, respond_delay: 2 });
applyHassUpdate(card, hass({ voice: 'processing' }));
check('processing applied (delay pending)', card._state === 'processing');
applyHassUpdate(card, hass({ voice: 'responding' }));
check('deferred: _state still processing during delay', card._state === 'processing');
check('deferred: respond-delay timer scheduled',
  card.animator._timers.has('respond-delay'));
await new Promise((r) => setTimeout(r, 2100));
check('deferred: fires after delay → responding', card._state === 'responding');

// THE LEAK: entity leaves responding while the deferred timer is pending.
// Before the fix, the pending timer fired later and slammed the card into
// responding visuals while the entity had moved on.
card = mockCard({ ...BASE_CONFIG, respond_delay: 2 });
applyHassUpdate(card, hass({ voice: 'processing' }));
applyHassUpdate(card, hass({ voice: 'responding' }));
check('leak setup: timer pending', card.animator._timers.has('respond-delay'));
// Entity goes back to processing BEFORE the delay elapses. mapped ===
// card._state ('processing') so applyState is skipped — the guard must
// clear the pending timer.
applyHassUpdate(card, hass({ voice: 'processing' }));
check('leak guard: respond-delay timer cleared',
  !card.animator._timers.has('respond-delay')
  && card.animator.clearedTimers.includes('respond-delay'));
await new Promise((r) => setTimeout(r, 2100));
check('leak guard: stale timer never fires (still processing)', card._state === 'processing');

// Idle entity with a pending timer also clears it
card = mockCard({ ...BASE_CONFIG, respond_delay: 2 });
applyHassUpdate(card, hass({ voice: 'responding' }));
check('idle-clear setup: timer pending', card.animator._timers.has('respond-delay'));
applyHassUpdate(card, hass({ voice: 'idle' }));
check('idle-clear: timer cleared', !card.animator._timers.has('respond-delay'));

// ── 3. connectedCallback cache reset ────────────────────────────────────
console.log('\n3. connectedCallback cache reset');

// Simulate: card had state, then HA detached + re-attached it. The reset
// must clear the raw caches so the next delivery re-evaluates.
card = mockCard(BASE_CONFIG);
applyHassUpdate(card, hass({ voice: 'responding' }));
check('pre-detach: responding applied', card._state === 'responding');
// connectedCallback cache reset (the exact lines from axidos-card.js)
card._lastHassVoice = null;
card._lastHassMedia = null;
card._lastHassBpm = null;
card._lastHassProgress = null;
// Entity is back to idle while the card still shows responding. With stale
// caches this delivery would be gated; with reset caches it heals.
applyHassUpdate(card, hass({ voice: 'idle' }));
check('post-reattach: stale caches cleared → heals to idle', card._state === 'idle');

// resolveState sanity (used by the pipeline)
check('resolveState: responding maps', resolveState('RESPONDING', 'paused') === 'responding');
check('resolveState: media playing promotes idle to dancing', resolveState('idle', 'playing') === 'dancing');

// ── Summary ─────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.error(`verify_state_recovery — ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('verify_state_recovery — ALL GREEN');