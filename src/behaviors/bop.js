/**
 * behaviors/bop.js — Spring-physics tap bop on a dedicated head layer.
 *
 * Fixed-timestep damped harmonic oscillator (shared spring.js) drives the
 * #head-bop SVG group — a transform layer nested INSIDE #axidos-head, so the
 * bop composes additively with whatever else is animating the head:
 *   #axidos-head   — idle poses / dance CSS-transition moves
 *   #head-bop      — tap bop spring (this file)
 *
 * Because the bop no longer owns #axidos-head's transform, background motion
 * can keep running during the bop:
 *  - idle: only the head-pose scheduler pauses on tap; pupil darting and the
 *    lid loop keep running. Once the spring has peaked and decays back to
 *    config.tap_bop_resume of its max amplitude, idle head poses RESUME
 *    while the tail bounces finish — the bop tail "melds" back into the
 *    idle animation instead of ending on a frozen frame.
 *  - dancing: the dance engine is HELD on tap — the beat clock keeps ticking
 *    (phase stays synced to the music) but pose moves and LED/eye/bellows
 *    accents are skipped. The dance resumes at the same tap_bop_resume
 *    threshold; its first post-hold move retargets from the frozen pose.
 *
 * The resume check is ARMED: it only trips after the spring has actually
 * bounced ABOVE the threshold once. Without arming, the spring's first
 * frames (position still ramping up from 0) would satisfy the threshold
 * immediately and background motion would resume on frame 1 regardless of
 * the configured resume point.
 *
 * Interruptible: re-tapping mid-bop KICKS the spring (energy-add velocity
 * boost that always amplifies the bounce, never cancels it) AND re-pauses/
 * re-arms the background (each tap is a fresh bop with a fresh meld point).
 * On settle the layer eases back to identity and saved LED state is restored.
 *
 * Tracked resource name: 'bop-raf'.
 */

import { stopIdleHeadPoses, startIdleHeadPoses } from './idle.js';
import { createSpring } from './spring.js';

/**
 * Pause background motion for the duration of the bop.
 *  - idle: stop the head-pose scheduler (pupil darting + lid loop keep
 *    running on their own elements).
 *  - dancing: set the dance hold flag — the beat clock keeps ticking so
 *    phase stays synced to the music, but the choreography skips its visual
 *    moves until the bop melds or settles.
 */
function pauseBackground(card, isDancing) {
  // Freeze in-flight motion FIRST: pausing the idle scheduler or holding the
  // dance only stops NEW moves — a pose transition already mid-flight would
  // keep animating #axidos-head while the bop spring bounces #head-bop (two
  // animations fighting over the head). freezeHeadMotion() snapshots the
  // live transforms inline with the transition disabled.
  card.animator.freezeHeadMotion();
  if (isDancing) {
    card._danceHeld = true;
  } else {
    stopIdleHeadPoses(card);
  }
}

/** Release the background hold (meld point or settle safety net). */
function resumeBackground(card, isDancing) {
  if (isDancing) {
    card._danceHeld = false;
  } else if (card._state === 'idle') {
    startIdleHeadPoses(card);
  }
}

export function bopHead(card) {
  const a = card.animator;
  const config = card.config;

  const backendSpeed = config.tap_speed !== undefined ? parseFloat(config.tap_speed) : 0.5;
  const bounces = Math.max(1, Math.min(20, config.tap_bounces !== undefined ? parseInt(config.tap_bounces) : 5));
  const intensity = config.tap_intensity !== undefined ? parseFloat(config.tap_intensity) : 1.0;
  // Fraction of max amplitude at which background head poses resume during
  // the tail (the "meld" point). Sanitized to 0.05–0.8, default 0.3.
  const resumeFrac = config.tap_bop_resume !== undefined ? parseFloat(config.tap_bop_resume) : 0.3;

  const maxAmp = 15 * intensity;
  const omega = 0.28 * Math.max(0.01, backendSpeed);
  const dampingRatio = Math.min(0.7, 0.6 / bounces);
  const initialVelocity = maxAmp * omega * 1.8;

  const isDancing = card._state === 'dancing';

  // Amplitude cap: peak amplitude ~= velocity / omega, so clamp the kick
  // velocity to keep the worst-case bounce at ~2.5x maxAmp no matter how
  // fast the user spam-clicks.
  const maxVelocity = 2.5 * maxAmp * omega;

  if (card._bopping && card._bopSpring) {
    // Energy-add kick: v' = sign(v)*sqrt(v^2 + v0^2). Unlike a plain
    // injectVelocity(+v0), this ALWAYS amplifies the bounce — tapping while
    // the head is rising from the trough no longer partially cancels the
    // injected energy and dampen the spring.
    card._bopSpring.kick(initialVelocity, maxVelocity);
    // Re-tap = a fresh bop: re-pause background motion and re-arm the
    // threshold so the new, larger bounce must peak before melding again.
    pauseBackground(card, isDancing);
    card._bopResumeArmed = false;
    card._bopResumed = false;
    // Re-derive the meld threshold from THIS bounce's peak: reset the peak
    // tracker to 0 and clear the peak-frozen flag so the RAF loop re-detects
    // the new bounce's true peak. Re-baselining to the CURRENT position would
    // collapse the threshold to ~0 at a trough and re-fire the early-meld bug.
    card._bopMaxSeen = 0;
    card._bopPeakFrozen = false;
    return;
  }

  // Idle: pause ONLY the head-pose behaviors (scans, blinks, glitches).
  // Pupil darting and the lid loop keep running — they drive separate
  // elements, so nothing conflicts, and the model never reads as frozen.
  // Dancing: hold the choreography (beat clock keeps running, visuals skip).
  pauseBackground(card, isDancing);

  const savedLedColor = a.currentLedColor;
  const savedLedOpacity = a.currentLedOpacity;

  const spring = createSpring({ omega, dampingRatio });
  // Seed the oscillator: a fresh spring starts at rest and would settle on
  // the first frame with zero visible motion.
  spring.injectVelocity(initialVelocity);
  card._bopSpring = spring;
  // Mark the bop active only after the spring exists: if anything above
  // throws, _bopping must stay false or every future tap would take the
  // re-tap branch against a null spring.
  card._bopping = true;

  let lastTime = performance.now();
  let lastLedUpdate = 0;
  // Dedupe guard for the per-frame transform write: the spring still steps
  // every frame, but the style write is skipped when the rounded transform
  // string is unchanged (sub-pixel frames at high refresh rates). Purely a
  // write optimization — the simulation itself is untouched.
  let lastWrittenTransform = "";
  a.cancelRaf('bop-raf');
  // The meld threshold is a fraction of the ACTUAL peak, not the theoretical
  // maxAmp — the velocity seed overshoots maxAmp by ~1.8x, so a maxAmp-based
  // threshold fired earlier than the slider implied.
  card._bopMaxSeen = 0;
  // Peak-frozen flag: the threshold must be computed ONCE from the bounce's
  // TRUE peak. While the spring is still rising, maxSeen grows every frame and
  // a moving threshold arms the meld almost immediately (the early-resume bug).
  // The peak is detected via the velocity sign flip — the first frame the
  // velocity turns negative, the spring has passed its first positive peak.
  card._bopPeakFrozen = false;

  const animate = (now) => {
    if (!card._bopping) return;

    let frameTime = now - lastTime;
    lastTime = now;
    if (frameTime > 100) frameTime = 16.666;

    const settled = spring.step(frameTime);

    if (settled) {
      card._bopping = false;
      card._bopSpring = null;
      // Ease the bop layer back to identity — any residual sub-pixel
      // displacement glides home instead of snapping.
      a.resetBopLayer();
      if (!isDancing) a.setLEDs(savedLedColor, savedLedOpacity);
      // Tail-resume safety net: if the resume threshold never tripped
      // (e.g. an extremely low tap_bop_resume or a tiny peak), release the
      // background hold now so idle/dance can never stay frozen.
      if (!card._bopResumed) resumeBackground(card, isDancing);
      card._bopResumeArmed = false;
      card._bopResumed = false;
      card._bopPeakFrozen = false;
      return;
    }

    const ty = spring.position;
    const rot = spring.position * 0.15;
    const scale = 1.0 - Math.abs(spring.position) * 0.003;
    if (a.el.headBop) {
      const t = `translate3d(0, ${ty.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      if (t !== lastWrittenTransform) {
        a.el.headBop.style.transition = 'none';
        a.el.headBop.style.transform = t;
        lastWrittenTransform = t;
      }
    }

    // Track the actual peak while the spring is rising. Once the velocity
    // flips negative (first descent), the peak is FROZEN — the threshold is
    // computed from this fixed value for the rest of the bounce, so the
    // configured resume fraction is honest and the meld cannot fire early.
    if (!card._bopPeakFrozen) {
      if (Math.abs(spring.position) > card._bopMaxSeen) {
        card._bopMaxSeen = Math.abs(spring.position);
      }
      if (spring.velocity < 0) {
        card._bopPeakFrozen = true;
      }
    }
    const threshold = card._bopMaxSeen * resumeFrac;

    // Arm the meld only after the spring has actually bounced ABOVE the
    // frozen threshold — the first frames ramp up from 0 and would otherwise
    // trip the check instantly, resuming background motion on frame 1.
    if (!card._bopResumeArmed && Math.abs(spring.position) > threshold) {
      card._bopResumeArmed = true;
    }

    // Tail meld: once armed and the bounce decays back to the configured
    // fraction of the FROZEN peak, resume the background motion (idle head
    // poses / dance choreography) while the tail is still bouncing on the
    // bop layer.
    if (!card._bopResumed && card._bopResumeArmed
        && Math.abs(spring.position) <= threshold) {
      card._bopResumed = true;
      resumeBackground(card, isDancing);
    }

    // LED brightness tracks displacement — idle only. During a dance the
    // beat loop owns the LEDs and would fight this every beat.
    if (!isDancing && now - lastLedUpdate > 60) {
      lastLedUpdate = now;
      const normPos = Math.min(1, Math.abs(spring.position) / maxAmp);
      const baseOp = parseFloat(savedLedOpacity) || 0.15;
      const ledOp = baseOp + (1 - baseOp) * normPos;
      a.setLedVars(savedLedColor, ledOp.toFixed(2));
    }

    a.requestRaf('bop-raf', animate);
  };
  a.requestRaf('bop-raf', animate);
}

export function stopBop(card) {
  const wasBopping = card._bopping;
  card._bopping = false;
  card._bopSpring = null;
  // Clear the meld/hold state so nothing leaks into the next bop or a
  // future dance cycle (stopBop also runs on every state change).
  card._bopResumeArmed = false;
  card._bopResumed = false;
  card._bopMaxSeen = 0;
  card._bopPeakFrozen = false;
  card._danceHeld = false;
  card.animator.cancelRaf('bop-raf');
  // Ease-clear the layer so a state change mid-bop glides home instead of
  // snapping. Only needed if a transform was actually written.
  if (wasBopping) card.animator.resetBopLayer();
}