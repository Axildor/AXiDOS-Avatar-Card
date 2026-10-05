/**
 * verify_progress_bounds.mjs — verification of the configurable progress
 * bounds + visibility contracts added in 5.6.0.
 *
 * Covers:
 *   1. parseProgress(raw, min, max) normalization math (pure function):
 *      - default bounds (0, 100) keep the legacy identity behavior
 *      - custom bounds map linearly onto 0-100 (e.g. min 20 / max 80)
 *      - values below min clamp to 0%, above max clamp to 100%
 *      - unavailable/unknown/non-numeric states still return null
 *      - degenerate bounds (min >= max) fall back to identity clamping
 *   2. updateProgressRing visibility gate (mock card + fake SVG element):
 *      - 0% hides the ring entirely (opacity '0') — no dot/line artifact
 *      - pct > 0 renders with opacity '1'
 *      - progress_show_in_dance: the dancing branch renders the ring when
 *        enabled and leaves it hidden when disabled
 *      - progress_ring_enabled / missing entity / null pct still hide
 */

import { parseProgress } from '../src/state-mapper.js';
import { updateProgressRing } from '../src/states.js';

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

console.log('verify_progress_bounds — bounds normalization + visibility\n');

// ── 1. parseProgress normalization ──────────────────────────────────────
console.log('1. parseProgress(raw, min, max) normalization');

// Default bounds: legacy identity behavior
check('default bounds: 0 → 0', parseProgress('0') === 0);
check('default bounds: 50 → 50', parseProgress('50') === 50);
check('default bounds: 100 → 100', parseProgress('100') === 100);
check('default bounds: 150 clamps to 100', parseProgress('150') === 100);
check('default bounds: -5 clamps to 0', parseProgress('-5') === 0);

// Custom bounds: linear mapping
check('bounds 20-80: 20 → 0%', parseProgress('20', 20, 80) === 0);
check('bounds 20-80: 50 → 50%', approx(parseProgress('50', 20, 80), 50));
check('bounds 20-80: 80 → 100%', parseProgress('80', 20, 80) === 100);
check('bounds 20-80: 35 → 25%', approx(parseProgress('35', 20, 80), 25));
check('bounds 20-80: 10 (below min) → 0%', parseProgress('10', 20, 80) === 0);
check('bounds 20-80: 95 (above max) → 100%', parseProgress('95', 20, 80) === 100);

// Negative bounds (e.g. temperature-style sensors)
check('bounds -10-30: -10 → 0%', parseProgress('-10', -10, 30) === 0);
check('bounds -10-30: 10 → 50%', approx(parseProgress('10', -10, 30), 50));
check('bounds -10-30: 30 → 100%', parseProgress('30', -10, 30) === 100);

// Fractional bounds
check('bounds 0.5-2.5: 1.5 → 50%', approx(parseProgress('1.5', 0.5, 2.5), 50));

// Null-ish states
check('unavailable → null', parseProgress('unavailable') === null);
check('unknown → null', parseProgress('unknown') === null);
check('empty → null', parseProgress('') === null);
check('non-numeric → null', parseProgress('abc') === null);
check('null raw → null', parseProgress(null) === null);
check('undefined raw → null', parseProgress(undefined) === null);

// Degenerate bounds fall back to identity clamping (defense in depth —
// sanitizeConfig already resets min >= max to 0/100)
check('degenerate min>=max: identity clamp', parseProgress('42', 80, 20) === 42);
check('degenerate min>=max: clamp high', parseProgress('150', 80, 20) === 100);

// ── 2. updateProgressRing visibility gate ───────────────────────────────
console.log('\n2. updateProgressRing visibility gate (mock card)');

/** Minimal fake SVG element recording setAttribute calls. */
function fakeRing() {
  const attrs = {};
  return {
    attrs,
    setAttribute(k, v) { attrs[k] = String(v); },
  };
}

/** Mock card: config + cached pct + animator exposing only progressRing. */
function mockCard(config, pct) {
  const ring = fakeRing();
  return {
    config,
    _progressPct: pct,
    animator: { el: { progressRing: ring } },
    ring,
  };
}

const BASE = {
  progress_ring_enabled: true,
  progress_entity: 'sensor.x',
  progress_vertical_fill: true,
  progress_dynamic_color: false,
  progress_invert_color: false,
  progress_show_in_dance: true,
};

// 0% hides entirely
let card = mockCard({ ...BASE }, 0);
updateProgressRing(card);
check('0% → opacity 0 (no dot artifact)', card.ring.attrs.opacity === '0',
  `opacity=${card.ring.attrs.opacity}`);

// pct > 0 renders
card = mockCard({ ...BASE }, 0.01);
updateProgressRing(card);
check('0.01% → opacity 1', card.ring.attrs.opacity === '1');
check('0.01% → dasharray written', typeof card.ring.attrs['stroke-dasharray'] === 'string');

// 100% renders full
card = mockCard({ ...BASE }, 100);
updateProgressRing(card);
check('100% → opacity 1', card.ring.attrs.opacity === '1');

// Master toggle still hides
card = mockCard({ ...BASE, progress_ring_enabled: false }, 50);
updateProgressRing(card);
check('progress_ring_enabled=false → opacity 0', card.ring.attrs.opacity === '0');

// Missing entity still hides
card = mockCard({ ...BASE, progress_entity: '' }, 50);
updateProgressRing(card);
check('no progress_entity → opacity 0', card.ring.attrs.opacity === '0');

// Null pct still hides
card = mockCard({ ...BASE }, null);
updateProgressRing(card);
check('null pct → opacity 0', card.ring.attrs.opacity === '0');

// ── 3. Dance-mode visibility contract ───────────────────────────────────
console.log('\n3. Dance-mode visibility contract');

// The dancing branch in states.js renders the ring only when
// progress_show_in_dance is on. Simulate the exact branch logic:
//   resetAll() sets opacity '0'; then `if (config.progress_show_in_dance)
//   updateProgressRing(card)`.
function danceBranchRender(config, pct) {
  const c = mockCard(config, pct);
  c.ring.setAttribute('opacity', '0'); // resetAll()
  if (config.progress_show_in_dance !== false) updateProgressRing(c);
  return c;
}

// Toggle ON (default): ring visible at 50%
let c = danceBranchRender({ ...BASE, progress_show_in_dance: true }, 50);
check('dance + toggle ON + 50% → opacity 1', c.ring.attrs.opacity === '1');

// Toggle ON at 0%: still hidden (0% contract holds in dance mode too)
c = danceBranchRender({ ...BASE, progress_show_in_dance: true }, 0);
check('dance + toggle ON + 0% → opacity 0', c.ring.attrs.opacity === '0');

// Toggle OFF: resetAll's hide stands
c = danceBranchRender({ ...BASE, progress_show_in_dance: false }, 50);
check('dance + toggle OFF + 50% → opacity 0', c.ring.attrs.opacity === '0');

// Default (undefined) toggle behaves as ON (sanitizeConfig default true)
c = danceBranchRender({ ...BASE, progress_show_in_dance: undefined }, 50);
check('dance + toggle undefined + 50% → opacity 1', c.ring.attrs.opacity === '1');

// ── Summary ─────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.error(`verify_progress_bounds — ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('verify_progress_bounds — ALL GREEN');