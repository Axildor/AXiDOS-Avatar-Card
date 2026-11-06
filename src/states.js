/**
 * states.js — Per-state visual application.
 *
 * applyStateVisuals() is the single entry point the card calls whenever the
 * internal state changes. It resets all animation layers, then configures
 * eye gradient / halo / LEDs / head pose for the target state and starts the
 * matching behavior engine.
 *
 * 5.7.0-beta.3 layer split: #eye-center / #eye-halo fill writes are replaced
 * by the variant-stack crossfade helpers (setEyeCenterColor /
 * setEyeHaloFill) — concurrent same-frame opacity swaps, no fill transitions
 * inside mover layers. The halo's master opacity (state brightness) is
 * written on the #eye-halo GROUP; the variant circles only carry the fill.
 *
 * Tracked resource name: 'respond-delay'.
 */

import {
  startLidBehavior, stopLidBehavior, startIdleCycle, stopIdleCycle,
  startRasterScan, stopRasterScan, servoToPose,
} from './behaviors/idle.js';
import { startDanceCycle, stopDanceCycle } from './behaviors/dance.js';
import { startTalkAnim, stopTalkAnim } from './behaviors/talk.js';
import { stopBop } from './behaviors/bop.js';
import { progressColor, verticalProgressDash } from './state-mapper.js';
import { resolveMotionMode, allowsBehaviorEngine, allowsStrobe } from './motion.js';
import { servoPersonality } from './personality.js';

/**
 * Resolve and cache the motion policy + servo personality for this delivery
 * (5.8.0). Both are DERIVED, never persisted: motion_intensity comes from
 * config, prefers_reduced_motion from the card's matchMedia listener, and the
 * personality from the same mood directive the dance consumes.
 *
 * Caching them on the card (rather than threading them through every behavior
 * call) keeps the per-beat dance path to a string read, and guarantees the
 * idle engine and the dance engine are looking at the SAME profile.
 */
function resolvePolicies(card, mood) {
  card._motionMode = resolveMotionMode(
    card.config ? card.config.motion_intensity : 'full',
    card._prefersReducedMotion === true,
  );
  card._personality = servoPersonality(mood);
}

/** Stop every behavior engine and reset all visual layers. */
function resetAll(card) {
  const a = card.animator;
  stopTalkAnim(card);
  stopLidBehavior(card);
  stopIdleCycle(card);
  stopRasterScan(card);
  stopDanceCycle(card);
  stopBop(card);
  a.el.ledMatrices.forEach((m) => m.classList.remove('pulsing'));
  if (typeof a.setLedTelemetry === 'function') a.setLedTelemetry(null);
  if (a.el.dangerRing) {
    a.el.dangerRing.setAttribute('opacity', '0');
    a.el.dangerRing.classList.remove('active');
  }
  // The progress ring is idle-only by default: every non-idle state hides it.
  // progress_show_in_dance opts the ring into dance mode (re-rendered below
  // in the dancing branch); all other non-idle states still hide it.
  if (a.el.progressRing) a.el.progressRing.setAttribute('opacity', '0');
  a.el.eyeLayerIdle.style.opacity = '0';
  a.el.eyeLayerListen.style.opacity = '0';
  a.el.eyeLayerProcess.style.opacity = '0';
  a.el.eyeLayerRespond.style.opacity = '0';
  a.el.eyeLayerDance.style.opacity = '0';
  a.el.eyeCenter.style.transform = 'scale(1)';
}

export function applyStateVisuals(card, state, bpm, mood) {
  const a = card.animator;

  // Motion policy (5.8.0) BEFORE resetAll: resetAll's dance teardown reads
  // nothing from it, but the state branches below all do.
  resolvePolicies(card, mood);
  const motionMode = card._motionMode;
  const engines = allowsBehaviorEngine(motionMode);
  const strobeOn = allowsStrobe(motionMode);

  resetAll(card);

  // ---- MOTION OFF: one static frame per state, zero scheduled work. ----
  // This is the literal meaning of motion_intensity: 'off'. Every behavior
  // engine is skipped, every loop stops, and the frame is composed once. It
  // is the cheapest mode by construction (nothing survives this function).
  if (!engines) {
    a.el.eyeLayerIdle.style.opacity = state === 'idle' ? '1' : '0';
    a.el.eyeLayerListen.style.opacity = state === 'listening' ? '1' : '0';
    a.el.eyeLayerProcess.style.opacity = state === 'processing' ? '1' : '0';
    a.el.eyeLayerRespond.style.opacity = state === 'responding' ? '1' : '0';
    a.el.eyeLayerDance.style.opacity = state === 'dancing' ? '1' : '0';
    a.setEyeHaloFill(stateHaloFill(state));
    a.el.eyeHalo.style.opacity = '0.05';
    a.setEyeCenterColor(stateCenterColor(state));
    a.setLEDs(stateLedColor(state), state === 'idle' ? '0.15' : '1');
    a.setPupil(0, 0);
    a.setBaseLid(0, 0);
    if (a.el.dangerRing) a.el.dangerRing.setAttribute('opacity', '0');
    if (state === 'idle') updateProgressRing(card);
    return;
  }

  if (state === 'idle') {
    a.el.eyeLayerIdle.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'opacity 0.8s';
    a.setEyeHaloFill('url(#haloGradIdle)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.setEyeCenterColor('#ffcc00');
    // 3.14 SERVO TRANSIENT: the head is driven onto the rest pose (overshoot
    // then settle) instead of being cut there by resetAll(). The previous
    // version wrote the pose 2.2 s after a hard reset, so the entry read as a
    // teleport followed by nothing.
    servoToPose(card, { r: 0, tx: 0, ty: 0, s: 1.0 }, { dur: 0.42, settleMs: 180 });
    a.setLid(0, 1.2);
    a.setPupil(0, 0);
    a.currentBaseLid = 0;
    a.setLEDs('#ffb800', '0.15');
    a.resetBodySwivel();
    updateProgressRing(card);
    startLidBehavior(card);
    startIdleCycle(card);
  } else if (state === 'dancing') {
    a.el.eyeLayerDance.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'opacity 0.15s ease-out';
    a.setEyeHaloFill('url(#haloGradDance)');
    a.setEyeCenterColor('#ffffff');
    a.el.eyeCenter.style.transformOrigin = '130px 364px';
    a.el.eyeCenter.style.transition = 'transform 0.1s ease-out';
    a.setLEDs('#1DB954', '0.15');
    a.resetBodySwivel();
    // Optional dance-mode ring: re-render after resetAll() hid it. The ring
    // is a static SVG overlay — the dance engine never touches it, so no
    // per-beat writes are needed; the hass setter updates it in place on
    // percentage changes while dancing.
    if (card.config.progress_show_in_dance !== false) updateProgressRing(card);
    startDanceCycle(card, bpm, mood);
  } else if (state === 'listening') {
    a.el.eyeLayerListen.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'opacity 0.8s';
    a.setEyeHaloFill('url(#haloGradListen)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.setEyeCenterColor('#aaffff');
    // Servo drive onto the listening pose. 5.8.1: a duplicate setHead() carrying
    // the yaw skew used to sit one line below this — same frame, so it replaced
    // the overshoot target and the servo transient never played. Gone with the
    // shear, so the drive is visible as designed.
    servoToPose(card, { r: 4, tx: 0, ty: -8, s: 1.06 }, { dur: 0.3, settleMs: 130 });
    a.setBaseLid(0.1, 0.4);
    a.setPupil(0, -3);
    a.setLEDs('#00ccff', '1');
    a.setBodySwivel(-2, 1, 1.4);
  } else if (state === 'processing') {
    a.el.eyeLayerProcess.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'opacity 0.8s';
    a.setEyeHaloFill('url(#haloGradProcess)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.setEyeCenterColor('#ffddaa');
    servoToPose(card, { r: -2, tx: 0, ty: 10, s: 0.96 }, { dur: 0.34, settleMs: 150 });
    a.setBaseLid(0.65, 0.5);
    a.setLEDs('#ff6600', '1');
    a.setBodySwivel(1, 0.98, 1.8);
    a.el.ledMatrices.forEach((m) => m.classList.add('pulsing'));
    startLidBehavior(card);
    // 1.5 DETERMINISTIC RASTER SCAN: a seeded boustrophedon sweep of the
    // socket, replacing the random dart loop. Same waypoint sequence on every
    // run (pinned by the verify suite), bounded inside the socket.
    startRasterScan(card);
  } else if (state === 'responding') {
    a.el.eyeLayerRespond.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'opacity 0.8s';
    a.setEyeHaloFill('url(#haloGradRespond)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.setEyeCenterColor('#ffaaaa');
    // FLASH SAFETY (3.13): the danger ring's authored 0.35 s cycle is 2.86 Hz
    // — over the 2 Hz budget. The class (whose keyframes are retuned to a
    // 0.5 s period in template.js) is only applied when the strobe channel is
    // allowed, so reduced motion removes the pulse entirely rather than
    // slowing it down.
    if (a.el.dangerRing) {
      a.el.dangerRing.setAttribute('opacity', '1');
      if (strobeOn) a.el.dangerRing.classList.add('active');
    }
    a.setLEDs('#ff2200', '1');
    a.setBodySwivel(0, 1, 0.8);
    startTalkAnim(card);
  }
}

/** Static-frame helpers (motion off) — the per-state optic/indicator colours. */
function stateHaloFill(state) {
  if (state === 'dancing') return 'url(#haloGradDance)';
  if (state === 'listening') return 'url(#haloGradListen)';
  if (state === 'processing') return 'url(#haloGradProcess)';
  if (state === 'responding') return 'url(#haloGradRespond)';
  return 'url(#haloGradIdle)';
}
function stateCenterColor(state) {
  if (state === 'listening') return '#aaffff';
  if (state === 'processing') return '#ffddaa';
  if (state === 'responding') return '#ffaaaa';
  if (state === 'dancing') return '#ffffff';
  return '#ffcc00';
}
function stateLedColor(state) {
  if (state === 'listening') return '#00ccff';
  if (state === 'processing') return '#ff6600';
  if (state === 'responding') return '#ff2200';
  if (state === 'dancing') return '#1DB954';
  return '#ffb800';
}

/**
 * Render the idle progress ring from card._progressPct (0-100 or null).
 * Lightweight: two attribute writes on #progress-ring only — no behavior
 * restart, no head-pose reset. Called from the idle state branch and from
 * the hass setter on a percentage-only change while idle.
 */
export function updateProgressRing(card) {
  const a = card.animator;
  const ring = a.el.progressRing;
  if (!ring) return;
  const pct = card._progressPct;
  const enabled = card.config.progress_ring_enabled !== false
    && card.config.progress_entity
    && pct !== null && pct !== undefined
    // 0% renders nothing: a zero-length dash with a round linecap still
    // paints a small dot/line at the bottom-center start point, so hide the
    // ring entirely instead of drawing an empty stroke.
    && pct > 0;
  if (!enabled) {
    ring.setAttribute('opacity', '0');
    return;
  }
  const dynamic = card.config.progress_dynamic_color === true;
  const inverted = card.config.progress_invert_color === true;
  // Vertical fill (default): a 3-value dasharray [L, 100−2L, L] lights two
  // dashes that BOTH climb from bottom-center (left side, then right side),
  // stopping at exactly pct% of the socket height with the gap at the top.
  // Circular fill: the original 360° clockwise sweep from bottom-center.
  ring.setAttribute(
    'stroke-dasharray',
    card.config.progress_vertical_fill !== false
      ? verticalProgressDash(pct)
      : `${pct} 100`,
  );
  ring.setAttribute('stroke', progressColor(pct, dynamic, inverted));
  ring.setAttribute('opacity', '1');
}

/**
 * Public state transition with respond_delay support: entering 'responding'
 * from another state can be deferred by config.respond_delay seconds.
 */
export function applyState(card, mapped, bpm, mood) {
  const a = card.animator;
  a.clearTimeout('respond-delay');
  const delaySeconds = card.config.respond_delay !== undefined ? parseFloat(card.config.respond_delay) : 0;
  if (mapped === 'responding' && card._state !== 'responding' && delaySeconds > 0) {
    a.setTimeout('respond-delay', () => {
      card._state = 'responding';
      applyStateVisuals(card, 'responding', bpm, mood);
    }, delaySeconds * 1000);
    return;
  }
  card._state = mapped;
  applyStateVisuals(card, mapped, bpm, mood);
}