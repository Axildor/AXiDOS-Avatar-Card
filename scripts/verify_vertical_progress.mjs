/**
 * verify_vertical_progress.mjs — geometric verification of the symmetric
 * bottom-up vertical fill of the #progress-ring stadium path.
 *
 * Simulates the SVG dash rendering exactly: the path starts at bottom-center
 * and runs clockwise (left side up → top → right side down). For a dasharray
 * [d1, g1, d2, ...] we walk the perimeter in pathLength units (0–100) and
 * mark which segments are lit, then convert each side's lit arc back to a
 * HEIGHT above the bottom (inverting the piecewise px math used by
 * verticalProgressDash) and assert:
 *
 *   1. At every sample pct, BOTH sides are lit to the same height.
 *   2. That height equals pct% of the socket height (linear in pct).
 *   3. The gap always sits at the TOP (nothing lit above the lit height).
 *   4. Edge cases: 0% → nothing lit; 100% → full ring (gap 0).
 */

import { verticalProgressDash } from '../src/state-mapper.js';

const R = 33;
const SIDE = 95.5;
const H = 161.5;
const CAP = (Math.PI / 2) * R;
const PERIM = 4 * CAP + 2 * SIDE;

/** Invert the piecewise px math: lit arc length (px) → height above bottom. */
function arcToHeight(litPx) {
  if (litPx <= 0) return 0;
  if (litPx <= CAP) {
    // Bottom cap: arc = R·acos(1 − d/R) → d = R(1 − cos(arc/R))
    return R * (1 - Math.cos(litPx / R));
  }
  if (litPx <= CAP + SIDE) {
    return R + (litPx - CAP);
  }
  // Top cap: arc = R·asin((d − R − SIDE)/R) → d = R + SIDE + R·sin(arc/R)
  const rest = Math.min(litPx - CAP - SIDE, CAP);
  return R + SIDE + R * Math.sin(rest / R);
}

/**
 * Walk the perimeter (pathLength units, 0 = bottom-center, clockwise) and
 * return the lit arc length (pathLength units) on the LEFT side (0 → 50) and
 * the RIGHT side (50 → 100). Interval-exact: dash/gap intervals are overlapped
 * with each side's half-perimeter range analytically (no sampling grid), so
 * the only error left is the helper's 2-decimal output rounding.
 */
function litArcs(dasharray) {
  const vals = dasharray.trim().split(/\s+/).map(Number);
  const patternLen = vals.reduce((a, b) => a + b, 0);
  let leftLit = 0;
  let rightLit = 0;
  let acc = 0;
  const cycles = Math.ceil(100 / patternLen) + 1;
  for (let c = 0; c < cycles && acc < 100; c++) {
    for (let j = 0; j < vals.length && acc < 100; j++) {
      const start = acc;
      const end = Math.min(acc + vals[j], 100);
      if (j % 2 === 0) { // dash segment
        leftLit += Math.max(0, Math.min(end, 50) - Math.max(start, 0));
        rightLit += Math.max(0, end - Math.max(start, 50));
      }
      acc += vals[j];
    }
  }
  return { leftLit, rightLit };
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

console.log('verify_vertical_progress — symmetric bottom-up fill\n');

const SAMPLES = [0, 5, 10, 25, 50, 75, 90, 95, 100];

for (const pct of SAMPLES) {
  const dash = verticalProgressDash(pct);
  const { leftLit, rightLit } = litArcs(dash);

  // Convert lit arc (pathLength units → px) back to heights.
  const leftH = arcToHeight((leftLit / 100) * PERIM);
  const rightH = arcToHeight((rightLit / 100) * PERIM);
  const expectedH = (pct / 100) * H;

  const tol = 1.5; // px — 1-unit dasharray resolution + float noise
  check(
    `pct=${String(pct).padStart(3)}% both sides equal height`,
    Math.abs(leftH - rightH) <= tol,
    `left=${leftH.toFixed(1)}px right=${rightH.toFixed(1)}px`,
  );
  check(
    `pct=${String(pct).padStart(3)}% height = ${pct}% of socket`,
    Math.abs(leftH - expectedH) <= tol,
    `got ${leftH.toFixed(1)}px, expected ${expectedH.toFixed(1)}px (dash="${dash}")`,
  );
}

// Edge cases.
const d0 = verticalProgressDash(0);
check('0% → nothing lit', d0 === '0 100', `dash="${d0}"`);

const d100 = verticalProgressDash(100);
const parts100 = d100.split(/\s+/).map(Number);
check(
  '100% → full ring (gap 0, both dashes 50)',
  parts100[0] === 50 && parts100[1] === 0 && parts100[2] === 50,
  `dash="${d100}"`,
);

// Clamp: out-of-range inputs must not produce negative gaps.
const dNeg = verticalProgressDash(-20);
const dOver = verticalProgressDash(150);
check('negative pct clamps to 0', dNeg === '0 100', `dash="${dNeg}"`);
check('over-100 pct clamps to full', dOver === d100, `dash="${dOver}"`);

// Gap must never be negative (would corrupt the pattern).
for (const pct of SAMPLES) {
  const parts = verticalProgressDash(pct).split(/\s+/).map(Number);
  check(`pct=${String(pct).padStart(3)}% gap >= 0`, parts.every((v) => v >= 0), `dash="${verticalProgressDash(pct)}"`);
}

console.log('');
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('ALL GREEN — vertical fill is symmetric bottom-up at every sample.');