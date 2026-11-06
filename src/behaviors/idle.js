/**
 * behaviors/idle.js — the idle behavior engine: aperture states, station-
 * keeping, yaw scans, mechanical glitch.
 *
 * All functions take `card` (the AxidosCard instance) which exposes:
 *   card.animator      — AxidosAnimator (motion primitives + tracked scheduling)
 *   card._state        — current internal state ('idle' | 'listening' | ...)
 *   card.config        — sanitized config
 *   card._motionMode   — resolved motion policy ('full' | 'reduced' | 'off')
 *   card._personality  — the servo profile shared with the dance (personality.js)
 *
 * 5.8.0 CHARACTER REWRITE. Everything here is mechanical:
 *  - The optic is an IRIS APERTURE, not an eyelid: it snaps between discrete
 *    states with a two-stage drive, it never "blinks" and never drifts.
 *  - At rest she does STATION-KEEPING: sub-degree corrections that hunt around
 *    the setpoint with a fast attack and a hard stop. There is no organic
 *    wander, no easing in and out, no direction of travel.
 *  - Scans TURN the housing (skewX yaw) so she looks along the rail instead of
 *    tilting her head like a person.
 *
 * Perf: every channel is TIMER-scheduled. The old lid loop was already moved
 * off RAF in 5.8.0-alpha; the glitch is the only RAF user left, and reduced
 * motion removes it outright.
 *
 * Tracked resource names: 'idle-behavior', 'idle-pupil', 'idle-aperture',
 * 'idle-glitch', 'lid-loop', 'idle-servo'.
 */

import {
  APERTURE, apertureAt, processingApertureAt, rasterWaypoints,
  stationKeepAt, servoSnap, SERVO_HARD_STOP_EASE,
} from './mechanical.js';
import {
  allowsGlitch, apertureHoldScale,
} from '../motion.js';
import {
  servoAmplitude, servoHold, SERVO_NEUTRAL,
} from '../personality.js';

/** The servo profile in force (neutral when no mood is steering). */
function personalityOf(card) {
  return card._personality || SERVO_NEUTRAL;
}

/** The resolved motion policy (full when the card predates it). */
function motionOf(card) {
  return card._motionMode || 'full';
}

// ---- Aperture (idle + processing) ----
//
// Replaces the old random walk (`currentBaseLid + (Math.random()-0.5)*0.15`
// every 1.5–4 s), which produced a continuously-jittering near-open optic —
// read as a nervous human eye. The aperture now selects one of three
// SEMANTIC states and holds it. Each transition is a two-stage mechanical
// snap: drive to (target + overshoot), then settle back onto the limit stop.
// Both stages are timer-scheduled, so a slow hold costs nothing.

function scheduleAperture(card, delayMs) {
  card.animator.setTimeout('lid-loop', () => apertureTick(card), delayMs);
}

function apertureTick(card) {
  const a = card.animator;
  const st = card._state;
  if (st !== 'idle' && st !== 'processing') return; // applyState restarts it
  const motion = motionOf(card);
  const profile = personalityOf(card);

  if (st === 'idle') {
    const idx = card._apertureIndex || 0;
    const ap = apertureAt(idx);
    card._apertureIndex = idx + 1;
    // Mood/personality shifts the resting aperture: a calm profile sits
    // heavier (more droop), a high-arousal profile sits more open. Clamped so
    // a profile can never close the optic or force it past fully open.
    const bias = profile.apertureBias || 0;
    const lid = Math.max(0, Math.min(0.95, ap.lid + bias));
    const stage1 = Math.max(0, Math.min(0.98, lid + (ap.stage1 - ap.lid)));
    a.setBaseLid(stage1, ap.snapMs / 1000);
    a.setTimeout('idle-servo', () => {
      if (card._state !== 'idle') return;
      a.setBaseLid(lid, 0.09); // hard stop: the limit stop takes it
    }, ap.snapMs);
    const hold = servoHold(ap.holdMs, profile) * apertureHoldScale(motion);
    scheduleAperture(card, hold);
  } else {
    // Processing: the iris steps through a narrow appraisal band. Still
    // timer-driven and bounded; it reads as throughput, not restlessness.
    const idx = card._processingAperture || 0;
    const ap = processingApertureAt(idx);
    card._processingAperture = idx + 1;
    a.setBaseLid(Math.max(0, Math.min(0.9, ap.lid + (profile.apertureBias || 0))), ap.durMs / 1000);
    scheduleAperture(card, ap.nextMs);
  }
}

export function startLidBehavior(card) {
  stopLidBehavior(card);
  card._apertureIndex = 0;
  card._processingAperture = 0;
  scheduleAperture(card, 0);
}

export function stopLidBehavior(card) {
  card.animator.clearTimeout('lid-loop');
  card.animator.clearTimeout('idle-servo');
}

// ---- Idle behaviors ----
//
// Every amplitude scales through the shared servo profile (personality.js),
// so a relaxed track does not dance chill moves while idling like a jackhammer.

/**
 * `exec(card, a, p)` where p is the servo profile.
 *
 * scan_right / scan_left use the new skewX yaw channel (2.6): the housing
 * turns AND the pose tilts, so she looks along the rail rather than nodding.
 * The yaw is deliberately opposite the head rotation — the casing leads, the
 * head follows, which is what a fixed optic on a slewing mount does.
 */
const IDLE_BEHAVIORS = [
  {
    name: 'passive',
    // 1.3 STATION-KEEPING instead of an exact rest-pose return.
    //
    // The old behavior wrote the literal rest pose (0,0,0) and left it there
    // for 6–13 s. A suspended mass under load is never exactly at nominal: the
    // servo hunts. This now issues a run of SUB-DEGREE corrective adjustments
    // with fast attack and a hard stop, at irregular seeded intervals. It is
    // still, it is just not DEAD — which is the entire character read.
    exec(card, a, p) {
      const start = card._stationKeepIndex || 0;
      const motion = motionOf(card);
      const steps = motion === 'reduced' ? 2 : 3;
      for (let k = 0; k < steps; k++) {
        const idx = start + k;
        const c = stationKeepAt(idx);
        const amp = servoAmplitude(1, p);
        a.setTimeout(`idle-servo-${k}`, () => {
          if (card._state !== 'idle') return;
          a.setHead(
            c.r * amp, c.tx * amp, c.ty * amp, 1.0,
            c.durMs / 1000, SERVO_HARD_STOP_EASE,
          );
        }, 320 + k * (900 + (idx % 3) * 260));
      }
      card._stationKeepIndex = start + steps;
      a.setBaseLid(a.currentBaseLid, 0.35);
    },
    min: 6000, max: 13000, weight: 4,
  },
  {
    name: 'scan_right',
    exec(card, a, p) {
      const k = servoAmplitude(1, p);
      a.setHead(12 * k, 0, -5 * k, 0.98, 1.1, SERVO_HARD_STOP_EASE, -5.5, 0.985);
      a.setBaseLid(APERTURE.narrow + (p.apertureBias || 0), 0.22);
      a.setBodySwivel(-2, 1, 1.6);
    },
    min: 4200, max: 8200, weight: 1.5,
  },
  {
    name: 'scan_left',
    exec(card, a, p) {
      const k = servoAmplitude(1, p);
      a.setHead(-12 * k, 0, -5 * k, 0.98, 1.1, SERVO_HARD_STOP_EASE, 5.5, 0.985);
      a.setBaseLid(APERTURE.narrow + (p.apertureBias || 0), 0.22);
      a.setBodySwivel(2, 1, 1.6);
    },
    min: 4200, max: 8200, weight: 1.5,
  },
  {
    name: 'curious',
    exec(card, a, p) {
      const k = servoAmplitude(1, p);
      a.setHead(8 * k, 0, -20 * k, 1.05, 0.95, SERVO_HARD_STOP_EASE, -3.5, 1.0);
      a.setBaseLid(APERTURE.wide + (p.apertureBias || 0), 0.18);
      a.setBodySwivel(-2, 1, 1.4);
    },
    min: 4000, max: 8000, weight: 2,
  },
  {
    name: 'contemptuous',
    // The appraisal pose: the aperture pinches down and the housing turns
    // slightly away. No blink-back timer — the aperture channel owns that.
    exec(card, a, p) {
      const k = servoAmplitude(1, p);
      a.setHead(-6 * k, 0, 15 * k, 0.95, 1.4, SERVO_HARD_STOP_EASE, 4.5, 0.98);
      a.setBaseLid(APERTURE.narrow + 0.06 + (p.apertureBias || 0), 0.2);
      a.setBodySwivel(1.5, 1, 1.8);
    },
    min: 5000, max: 10000, weight: 2,
  },
  {
    name: 'alert',
    exec(card, a, p) {
      const k = servoAmplitude(1, p);
      a.setHead(0, 0, -25 * k, 1.08, 0.22, SERVO_HARD_STOP_EASE, 0, 1.0);
      a.setBaseLid(APERTURE.wide, 0.12);
      a.setBodySwivel(-1, 1, 0.4);
    },
    min: 1500, max: 3000, weight: 1,
  },
  {
    name: 'bored',
    exec(card, a, p) {
      const k = servoAmplitude(1, p);
      a.setHead(2 * k, 0, 20 * k, 0.96, 2.2, SERVO_HARD_STOP_EASE, -2, 1.0);
      a.setBaseLid(APERTURE.half, 0.5);
      a.setBodySwivel(1, 1, 2.6);
    },
    min: 7000, max: 14000, weight: 1.5,
  },
  {
    name: 'full_swivel',
    exec(card, a, p) {
      const k = servoAmplitude(1, p);
      a.setBodySwivel(-6, 0.96, 2.2);
      a.setTimeout('idle-blink', () => {
        if (card._state !== 'idle') return;
        a.setHead(6 * k, 0, -3 * k, 1.02, 1.0, SERVO_HARD_STOP_EASE, -4, 0.99);
        a.setBaseLid(APERTURE.half, 0.3);
      }, 600);
    },
    min: 4000, max: 8000, weight: 0.8,
  },
  {
    name: 'glitch',
    // Stepped mechanical glitch: discrete 60 ms held frames, no smoothing.
    // REMOVED ENTIRELY under reduced motion (allowsGlitch) — it is the one
    // idle channel that is pure flashing, so suppressing it is the whole
    // point of the reduced mode rather than a slower version of it.
    exec(card, a, p) {
      if (!allowsGlitch(motionOf(card))) return;
      let count = 0, lastTime = 0;
      a.cancelRaf('idle-glitch');
      const glitchLoop = (timestamp) => {
        if (!lastTime) lastTime = timestamp;
        if (timestamp - lastTime > 60) {
          lastTime = timestamp;
          if (card._state !== 'idle' || count > 12) {
            a.cancelRaf('idle-glitch');
            if (card._state === 'idle') {
              a.setEyeHaloFill('url(#haloGradIdle)');
              a.setEyeCenterColor('#ffcc00');
              a.setHead(0, 0, 0, 1.0, 0.4, SERVO_HARD_STOP_EASE);
            }
            return;
          }
          a.setHead(
            (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8, 1.0, 0.05, 'steps(1, end)',
          );
          if (count % 2 === 0) {
            a.setEyeHaloFill('#110000');
            a.setEyeCenterColor('#884400');
          } else {
            a.setEyeHaloFill('#ffb800');
            a.setEyeCenterColor('#ffffff');
          }
          count++;
        }
        a.requestRaf('idle-glitch', glitchLoop);
      };
      a.requestRaf('idle-glitch', glitchLoop);
    },
    min: 4000, max: 7000, weight: 0.3,
  },
];

// ---- Pupil station-keeping + raster scan ----

function dartPupil(card) {
  if (card._state !== 'idle') return;
  const a = card.animator;
  const p = personalityOf(card);
  // Pupil darts are the OPTIC's only independent motion: a rigidly mounted
  // optic still has to track. Sub-degree scale, hard stop, irregular cadence.
  const max = 5 * servoAmplitude(1, p);
  a.setPupil((Math.random() - 0.5) * max * 2, (Math.random() - 0.5) * max * 2);
  a.setTimeout('idle-pupil', () => dartPupil(card), 900 + Math.random() * 2600);
}

function runNextIdleBehavior(card) {
  if (card._state !== 'idle') return;
  const a = card.animator;
  const p = personalityOf(card);
  let r = Math.random() * IDLE_BEHAVIORS.reduce((s, b) => s + b.weight, 0);
  let chosen = IDLE_BEHAVIORS[0];
  for (const b of IDLE_BEHAVIORS) {
    r -= b.weight;
    if (r <= 0) { chosen = b; break; }
  }
  try { chosen.exec(card, a, p); } catch (err) { /* one behavior must never kill the cycle */ }
  const dwell = servoHold(chosen.min + Math.random() * (chosen.max - chosen.min), p);
  a.setTimeout('idle-behavior', () => runNextIdleBehavior(card), dwell);
}

/**
 * STARTUP POSTURE (3.14): instead of snapping to the rest pose, the head is
 * SERVOED onto it — the same two-stage drive (overshoot, then settle on the
 * limit stop) that a real actuator uses. Called by states.js on state entry.
 * Delegates to mechanical.servoSnap so there is exactly ONE servo-drive
 * definition in the codebase (the idle station-keeping and the state entry
 * must not drift into two different "mechanical" feels).
 */
export function servoToPose(card, pose, opts) {
  servoSnap(card.animator, pose, {
    dur: (opts && opts.dur) || 0.34,
    settleMs: (opts && opts.settleMs) || 150,
    name: 'state-servo',
  });
}

export function startIdleCycle(card) {
  stopIdleCycle(card);
  card._stationKeepIndex = 0;
  dartPupil(card);
  card.animator.setTimeout('idle-behavior', () => runNextIdleBehavior(card), 2000 + Math.random() * 3000);
}

/**
 * Stop only the head-pose idle behaviors (scans, glitches, blinks) while
 * leaving pupil darting alive. Used by the tap bop: the bop spring owns the
 * head transform, but the pupil is a separate element and keeps darting so
 * the model never reads as frozen during the bop.
 */
export function stopIdleHeadPoses(card) {
  card.animator.clearTimeout('idle-behavior');
  card.animator.clearTimeout('idle-blink');
  for (let k = 0; k < 3; k++) card.animator.clearTimeout(`idle-servo-${k}`);
  card.animator.cancelRaf('idle-glitch');
}

/**
 * Restart just the head-pose behavior scheduler (pupil darting already
 * running). Used by the bop tail-resume: idle poses resume while the bop
 * spring is still finishing its decay on the dedicated #head-bop layer.
 *
 * The head was FROZEN mid-pose by freezeHeadMotion() (transition: none) when
 * the bop started. Before re-arming the scheduler, the frozen pose is
 * re-applied WITH a transition so the first post-meld behavior eases from
 * where the head actually is instead of teleporting to its new target —
 * a teleport here reads as "a new animation fired" right after the bop.
 */
export function startIdleHeadPoses(card) {
  if (card._state !== 'idle') return;
  // Un-freeze the head: re-apply the live computed transform with a short
  // transition so the next setHead() call eases from the frozen pose rather
  // than snapping (the frozen inline transform has transition: none).
  const a = card.animator;
  try {
    // Layer split: #axidos-head exists in the head AND eye layers (mirror
    // chains). Each copy is un-frozen from its OWN computed transform so
    // both stay registered.
    for (const head of a.el.head) {
      const t = getComputedStyle(head).transform;
      if (t && t !== 'none') {
        head.style.transition = 'transform 0.6s cubic-bezier(0.34,1.06,0.64,1)';
        head.style.transform = t;
      } else {
        head.style.transition = '';
      }
    }
  } catch (err) { /* stub environments */ }
  a.clearTimeout('idle-behavior');
  a.setTimeout('idle-behavior', () => runNextIdleBehavior(card), 300 + Math.random() * 800);
}

export function stopIdleCycle(card) {
  stopIdleHeadPoses(card);
  card.animator.clearTimeout('idle-pupil');
}

// ---- Raster scan (processing) ----
//
// Replaces the random dart loop in states.js. The iris sweeps a fixed
// boustrophedon raster over the socket: left→right, right→left, three rows.
// Deterministic (seeded), bounded, and timer-driven — it reads as a scanner
// reading lines of data rather than as an eye flicking around a room.

const RASTER_SEED = 0;

export function startRasterScan(card) {
  stopRasterScan(card);
  if (card._state !== 'processing') return;
  const a = card.animator;
  const p = personalityOf(card);
  const k = servoAmplitude(1, p);
  card._rasterIndex = 0;
  const pts = rasterWaypoints(RASTER_SEED);
  const step = () => {
    if (card._state !== 'processing') return;
    const i = card._rasterIndex % pts.length;
    const pt = pts[i];
    card._rasterIndex++;
    a.setPupil(pt.x * k, pt.y * k);
    a.setTimeout('process-dart', step, pt.holdMs);
  };
  a.setTimeout('process-dart', step, 0);
}

export function stopRasterScan(card) {
  card.animator.clearTimeout('process-dart');
}
