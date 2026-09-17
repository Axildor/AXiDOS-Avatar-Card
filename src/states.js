/**
 * states.js — Per-state visual application.
 *
 * applyStateVisuals() is the single entry point the card calls whenever the
 * internal state changes. It resets all animation layers, then configures
 * eye gradient / halo / LEDs / head pose for the target state and starts the
 * matching behavior engine.
 *
 * Tracked resource name: 'respond-delay'.
 */

import { startLidBehavior, stopLidBehavior, startIdleCycle, stopIdleCycle } from './behaviors/idle.js';
import { startDanceCycle, stopDanceCycle } from './behaviors/dance.js';
import { startTalkAnim, stopTalkAnim } from './behaviors/talk.js';
import { stopBop } from './behaviors/bop.js';
import { progressColor, verticalProgressDash } from './state-mapper.js';

/** Stop every behavior engine and reset all visual layers. */
function resetAll(card) {
  const a = card.animator;
  stopTalkAnim(card);
  stopLidBehavior(card);
  stopIdleCycle(card);
  stopDanceCycle(card);
  stopBop(card);
  a.el.ledMatrices.forEach((m) => m.classList.remove('pulsing'));
  if (a.el.dangerRing) a.el.dangerRing.setAttribute('opacity', '0');
  // The progress ring is idle-only: every non-idle state hides it.
  if (a.el.progressRing) a.el.progressRing.setAttribute('opacity', '0');
  a.el.eyeLayerIdle.style.opacity = '0';
  a.el.eyeLayerListen.style.opacity = '0';
  a.el.eyeLayerProcess.style.opacity = '0';
  a.el.eyeLayerRespond.style.opacity = '0';
  a.el.eyeLayerDance.style.opacity = '0';
  a.el.eyeCenter.style.transform = 'scale(1)';
  a.el.eyeCenter.style.transition = 'fill 0.8s ease-in-out';
}

export function applyStateVisuals(card, state, bpm) {
  const a = card.animator;

  resetAll(card);

  if (state === 'idle') {
    a.el.eyeLayerIdle.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'fill 0.8s ease-in-out, opacity 0.8s';
    a.el.eyeHalo.setAttribute('fill', 'url(#haloGradIdle)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.el.eyeCenter.setAttribute('fill', '#ffcc00');
    a.setHead(0, 0, 0, 1.0, 2.2);
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
    a.el.eyeHalo.style.transition = 'fill 0.8s ease-in-out, opacity 0.15s ease-out';
    a.el.eyeHalo.setAttribute('fill', 'url(#haloGradDance)');
    a.el.eyeCenter.setAttribute('fill', '#ffffff');
    a.el.eyeCenter.style.transformOrigin = '130px 364px';
    a.el.eyeCenter.style.transition = 'transform 0.1s ease-out, fill 0.8s ease-in-out';
    a.setLEDs('#1DB954', '0.15');
    a.resetBodySwivel();
    startDanceCycle(card, bpm);
  } else if (state === 'listening') {
    a.el.eyeLayerListen.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'fill 0.8s ease-in-out, opacity 0.8s';
    a.el.eyeHalo.setAttribute('fill', 'url(#haloGradListen)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.el.eyeCenter.setAttribute('fill', '#aaffff');
    a.setHead(4, 0, -8, 1.06, 1.0);
    a.setBaseLid(0.1, 0.4);
    a.setPupil(0, -3);
    a.setLEDs('#00ccff', '1');
    a.setBodySwivel(-2, 1, 1.4);
  } else if (state === 'processing') {
    a.el.eyeLayerProcess.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'fill 0.8s ease-in-out, opacity 0.8s';
    a.el.eyeHalo.setAttribute('fill', 'url(#haloGradProcess)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.el.eyeCenter.setAttribute('fill', '#ffddaa');
    a.setHead(-2, 0, 10, 0.96, 1.4);
    a.setBaseLid(0.65, 0.5);
    a.setLEDs('#ff6600', '1');
    a.setBodySwivel(1, 0.98, 1.8);
    a.el.ledMatrices.forEach((m) => m.classList.add('pulsing'));
    startLidBehavior(card);
    const dart = () => {
      if (card._state !== 'processing') return;
      a.setPupil((Math.random() - 0.5) * 12, 4);
      a.setTimeout('process-dart', dart, 200 + Math.random() * 600);
    };
    dart();
  } else if (state === 'responding') {
    a.el.eyeLayerRespond.style.opacity = '1';
    a.el.eyeHalo.style.transition = 'fill 0.8s ease-in-out, opacity 0.8s';
    a.el.eyeHalo.setAttribute('fill', 'url(#haloGradRespond)');
    a.el.eyeHalo.style.opacity = '0.05';
    a.el.eyeCenter.setAttribute('fill', '#ffaaaa');
    if (a.el.dangerRing) a.el.dangerRing.setAttribute('opacity', '1');
    a.setLEDs('#ff2200', '1');
    a.setBodySwivel(0, 1, 0.8);
    startTalkAnim(card);
  }
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
    && pct !== null && pct !== undefined;
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
export function applyState(card, mapped, bpm) {
  const a = card.animator;
  a.clearTimeout('respond-delay');
  const delaySeconds = card.config.respond_delay !== undefined ? parseFloat(card.config.respond_delay) : 0;
  if (mapped === 'responding' && card._state !== 'responding' && delaySeconds > 0) {
    a.setTimeout('respond-delay', () => {
      card._state = 'responding';
      applyStateVisuals(card, 'responding', bpm);
    }, delaySeconds * 1000);
    return;
  }
  card._state = mapped;
  applyStateVisuals(card, mapped, bpm);
}