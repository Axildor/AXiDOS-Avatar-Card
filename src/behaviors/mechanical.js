/**
 * behaviors/mechanical.js — mechanical motion primitives (5.8.0).
 *
 * AXiDOS is a suspended mechanical assembly, not a creature. Everything in
 * this file obeys that: no breathing, no blinking, no saccadic drift, no
 * anticipation. The vocabulary is the servo's — fast attack, hard stop,
 * settling overshoot, limit stops, hold-then-snap, and station-keeping
 * against a load.
 *
 * PURE + DETERMINISTIC: every generator here is a function of an integer
 * step, seeded through choreography's hash32/mulberry32. There is no
 * Math.random and no wall clock, so two runs produce byte-identical
 * schedules — the property the verify suite pins.
 *
 * Everything is TIMER-scheduled by the callers (idle.js / states.js). Nothing
 * here uses requestAnimationFrame: an aperture that re-evaluates a few times
 * per minute must not wake the main thread 60 times a second.
 */

import { hash32, mulberry32 } from './choreography.js';

/** Seed scratch for one deterministic draw stream. */
function stream(seed) {
  return mulberry32(hash32(seed >>> 0));
}

// ---- Aperture (idle face) ----
//
// The optic is an IRIS APERTURE, not an eye: it has no eyelids, so it cannot
// blink or squint. It opens and closes in discrete mechanical states:
//
//   narrow — the housing pinches down: appraisal, scrutiny, "I am looking at
//            you and I have reached a conclusion about you".
//   half   — the resting droop of a machine with nothing to do: boredom.
//   wide   — fully open: alert, listening, tracking a new input.
//
// The lid AMOUNT is the droop (0 = fully open, 1 = closed to a slit), matching
// animator.setLid()/setBaseLid().

/** Aperture states, expressed as lid droop amounts. */
export const APERTURE = Object.freeze({
  narrow: 0.62, // appraisal
  half: 0.34,   // boredom
  wide: 0.04,   // alert
});

/**
 * The state cycle. A CONSTANT permutation, so consecutive events can never
 * repeat the same aperture (the step advances by exactly one slot) — a
 * repeated state would be a no-op write and read as a frozen aperture.
 * Irregularity comes from the seeded hold/snap timing, not from the order.
 */
export const APERTURE_CYCLE = Object.freeze(['wide', 'narrow', 'half']);

/**
 * Bounded hold window (ms). The old random walk re-evaluated every
 * 1500–4000 ms with a fresh random amount; holds here are strictly LONGER
 * (>= 4200 ms) and bounded above, so the aperture is still far more often
 * than it moves. Stillness is character.
 */
export const APERTURE_MIN_HOLD_MS = 4200;
export const APERTURE_MAX_HOLD_MS = 11000;

/** Two-stage snap: the fast attack, then the settle to the limit stop. */
export const APERTURE_SNAP_MS_MIN = 150;
export const APERTURE_SNAP_MS_MAX = 260;
/** Overshoot past the limit stop before it settles back (lid units). */
export const APERTURE_OVERSHOOT = 0.05;

/**
 * The aperture for step `index` (monotonic per card instance).
 *
 * Returns the final droop, the two-stage first write (droop + overshoot,
 * clamped to the mechanical limit), the attack duration and the hold.
 *
 * @param {number} index - monotonic event counter
 * @returns {{state:string, lid:number, stage1:number, snapMs:number, holdMs:number}}
 */
export function apertureAt(index) {
  const i = Math.max(0, Math.floor(index) || 0);
  const r = stream(Math.imul(i + 1, 0x9e3779b1));
  const state = APERTURE_CYCLE[i % APERTURE_CYCLE.length];
  const lid = APERTURE[state];
  const snapMs = APERTURE_SNAP_MS_MIN
    + Math.round(r() * (APERTURE_SNAP_MS_MAX - APERTURE_SNAP_MS_MIN));
  const holdMs = APERTURE_MIN_HOLD_MS
    + Math.round(r() * (APERTURE_MAX_HOLD_MS - APERTURE_MIN_HOLD_MS));
  // Overshoot TOWARD closure (the aperture drives past its stop and the stop
  // pushes back) — clamped so the optic never fully closes.
  const stage1 = Math.min(0.98, lid + APERTURE_OVERSHOOT);
  return { state, lid, stage1, snapMs, holdMs };
}

/**
 * Processing aperture: while the machine is computing, the iris sits in a
 * narrow appraisal band and steps through it. Short cadence by design (this
 * is the one place a fast aperture is honest — it reads as throughput), but
 * still deterministic and bounded.
 *
 * @param {number} index
 * @returns {{lid:number, durMs:number, nextMs:number}}
 */
export function processingApertureAt(index) {
  const i = Math.max(0, Math.floor(index) || 0);
  const r = stream(Math.imul(i + 1, 0x85ebca77));
  return {
    lid: 0.45 + r() * 0.4,          // narrow band: 0.45..0.85 droop
    durMs: 120 + Math.round(r() * 160), // 120..280 ms attack
    nextMs: 120 + Math.round(r() * 280), // 120..400 ms cadence (bounded)
  };
}

// ---- Deterministic raster scan (processing pupil) ----
//
// Replaces the random dart loop. The iris sweeps a RASTER: left→right across
// a row, then right→left on the next row (boustrophedon), three rows, with a
// sub-pixel seeded jitter so the sweep is mechanical rather than a metronome.
// It reads as a scanner reading lines of data, not as restless looking.

export const RASTER_ROWS = 3;
export const RASTER_COLS = 4;
/** Horizontal/vertical bounds (px). Inside the 5.4 px socket translation
 *  budget with margin, and further clamped by socketClip in template.js. */
export const RASTER_MAX_X = 6.4;
export const RASTER_MAX_Y = 3.2;

/**
 * The complete waypoint sequence for one raster pass. Pure: the same seed
 * always yields the same array (the determinism contract).
 *
 * @param {number} [seed=0]
 * @returns {{x:number, y:number, holdMs:number}[]}
 */
export function rasterWaypoints(seed = 0) {
  const pts = [];
  for (let row = 0; row < RASTER_ROWS; row++) {
    const forward = row % 2 === 0;
    for (let step = 0; step < RASTER_COLS; step++) {
      const col = forward ? step : (RASTER_COLS - 1 - step);
      const r = stream(
        (Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(row * RASTER_COLS + step + 1, 0xc2b2ae3d)) >>> 0,
      );
      const x = ((col / (RASTER_COLS - 1)) * 2 - 1) * RASTER_MAX_X + (r() - 0.5) * 0.5;
      const y = ((row / (RASTER_ROWS - 1)) * 2 - 1) * (RASTER_MAX_Y * 0.6) + (r() - 0.5) * 0.4;
      pts.push({
        x: Math.max(-RASTER_MAX_X, Math.min(RASTER_MAX_X, x)),
        y: Math.max(-RASTER_MAX_Y, Math.min(RASTER_MAX_Y, y)),
        holdMs: 90 + Math.round(r() * 90),
      });
    }
  }
  return pts;
}

// ---- Station-keeping (the resting posture) ----
//
// At rest the assembly does not "return to exactly zero" — a suspended mass
// under load is never exactly at its nominal pose, it is held there by a
// servo that keeps correcting. These are SUB-DEGREE corrections: the head
// hunts around its setpoint in tiny, fast, hard-stopped steps. It reads as
// active station-keeping, not as organic idle wander (there is no drift
// direction, no easing in and out, no sine).

export const STATION_KEEP_MAX_R = 0.45;   // degrees
export const STATION_KEEP_MAX_TX = 0.5;   // px
export const STATION_KEEP_MAX_TY = 0.8;   // px
export const STATION_KEEP_ATTACK_MS_MIN = 160;
export const STATION_KEEP_ATTACK_MS_MAX = 280;

/**
 * A single corrective adjustment. Fast attack, hard stop, sub-degree.
 * @param {number} index
 * @returns {{r:number, tx:number, ty:number, durMs:number}}
 */
export function stationKeepAt(index) {
  const i = Math.max(0, Math.floor(index) || 0);
  const r = stream(Math.imul(i + 1, 0x27d4eb2d));
  const rDeg = (r() * 2 - 1) * STATION_KEEP_MAX_R;
  const tx = (r() * 2 - 1) * STATION_KEEP_MAX_TX;
  const ty = (r() * 2 - 1) * STATION_KEEP_MAX_TY;
  const durMs = STATION_KEEP_ATTACK_MS_MIN
    + Math.round(r() * (STATION_KEEP_ATTACK_MS_MAX - STATION_KEEP_ATTACK_MS_MIN));
  return { r: rDeg, tx, ty, durMs };
}

/** The hard-stop curve: linear drive to the stop, then no cushion. */
export const SERVO_HARD_STOP_EASE = 'cubic-bezier(0.12, 1, 0.25, 1)';

// ---- Servo state transient ----
//
// 3.14: a state change used to be a hard cut (resetAll() then the new pose in
// one jump). A real actuator drives to the new setpoint and the limit stop
// takes the overshoot. servoSnap() performs that as TWO writes: the drive
// (past the setpoint) and the settle back onto it. State changes are rare
// (a few per minute), so two writes here cost nothing.

/** Fraction past the target the drive stage goes. */
export const SERVO_OVERSHOOT = 0.06;

/**
 * Write a servo transient for a head target: stage 1 drives past the
 * setpoint with a fast attack, a tracked timer then settles onto it.
 *
 * @param {object} a - AxidosAnimator
 * @param {{r:number, tx:number, ty:number, s:number}} pose
 * @param {{dur:number, ease?:string, settleMs?:number, name?:string}} opts
 */
export function servoSnap(a, pose, opts) {
  const dur = opts && typeof opts.dur === 'number' ? opts.dur : 0.34;
  const ease = (opts && opts.ease) || 'cubic-bezier(0.08, 0.95, 0.12, 1.02)';
  const settleMs = (opts && typeof opts.settleMs === 'number') ? opts.settleMs : 140;
  const name = (opts && opts.name) || 'servo-settle';
  const over = 1 + SERVO_OVERSHOOT;
  a.setHead(pose.r * over, pose.tx * over, pose.ty * over, pose.s, dur, ease);
  a.setTimeout(name, () => {
    a.setHead(pose.r, pose.tx, pose.ty, pose.s, 0.24, SERVO_HARD_STOP_EASE);
  }, settleMs);
}
