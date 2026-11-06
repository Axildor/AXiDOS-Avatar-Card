/**
 * animator.js — AxidosAnimator: element refs + motion primitives + resource registry.
 *
 * This class owns every DOM reference and every motion primitive. Behavior
 * modules (idle/dance/talk/bop) drive the SVG exclusively through this class,
 * and MUST schedule timers/RAFs through the tracked helpers so that
 * stopAll() can guarantee zero leaks on teardown or state change.
 *
 * 5.7.0-beta.3 LAYER SPLIT: the artwork is 5 stacked SVGs (template.js).
 * Pivot groups that exist in MULTIPLE layers (#axidos-head, #head-bop,
 * #torso-swivel — the eye/LED layers carry mirror chains) are referenced as
 * LISTS via querySelectorAll, and every JS transform write goes to ALL
 * copies so the layers stay registered (C1/C2). CSS id selectors already
 * match every copy for the keyframe-driven pivots (#body-pivot,
 * #head-sway-pivot). el.svg became el.svgs (all 5 layer roots).
 *
 * #eye-center / #eye-halo are now GROUPS carrying pre-painted variant
 * circles (template.js). setEyeCenterColor()/setEyeHaloFill() crossfade the
 * variants with CONCURRENT same-frame opacity swaps (A1): the incoming
 * variant's opacity 0→1 and the outgoing 1→0 are written in the same frame —
 * never a sequential swap, which would leave both mid-flight and flash the
 * paint beneath. Out-of-set colors use the 'dynamic' fallback variant
 * (fill written directly, opacity-toggled like the rest).
 */

import { EYE_CENTER_VARIANTS, EYE_HALO_VARIANTS } from './template.js';

/**
 * Hard clamp on the fake-yaw skew (degrees).
 *
 * The head casing is a rounded 130 px-wide shell inside a 66 px-wide socket
 * cavity (template.js: #rect74 spans x=73..207, the faceplate cavity x=97..163).
 * A skewX of 6 degrees displaces the casing's extreme top/bottom edge by
 * tan(6°) × ~124 px ≈ 13 px, which is inside the 24 px of casing that sits
 * outside the cavity on each side — the silhouette stays whole. Past ~7
 * degrees the leading edge starts to look sheared rather than turned, so 6 is
 * the mechanical limit stop. The verify suite asserts the clamp.
 */
export const MAX_HEAD_SKEW = 6;

export class AxidosAnimator {
  /**
   * @param {ShadowRoot} shadowRoot - the card's shadow root
   * @param {number} [fpsMax=60] - JS motion frame cap (5.7.0-beta.3). All
   *   requestRaf-driven motion loops (bop spring, idle glitch) share one
   *   frame-budget accumulator: callbacks fire at most fpsMax times per
   *   second, with the REAL rAF timestamp forwarded so dt-based integrators
   *   (spring.js) produce pixel-identical trajectories — only tick COUNT
   *   drops. fpsMax >= 240 disables the gate entirely (ungated fast path).
   */
  constructor(shadowRoot, fpsMax = 60) {
    const root = shadowRoot;
    this._fpsMax = (typeof fpsMax === 'number' && Number.isFinite(fpsMax) && fpsMax >= 30)
      ? fpsMax : 60;
    // Shared gate clock for ALL tracked RAF loops (one tick grid — the
    // motion loops are mutually exclusive in practice: the bop holds idle
    // poses, the glitch is rare). null = next frame fires immediately.
    this._lastGate = null;
    // Layer-split refs: pivot groups duplicated across mover layers are
    // LISTS (write-to-all); singletons stay single elements. getElementById
    // would return only the FIRST copy — the mirrors would desync.
    this.el = {
      svgs: root.querySelectorAll('svg.axidos-layer'),
      head: [...root.querySelectorAll('#axidos-head')],
      headBop: [...root.querySelectorAll('#head-bop')],
      torsoSwivel: [...root.querySelectorAll('#torso-swivel')],
      hitbox: root.getElementById('hitbox'),
      eyeLayerIdle: root.getElementById('eye-layer-idle'),
      eyeLayerListen: root.getElementById('eye-layer-listen'),
      eyeLayerProcess: root.getElementById('eye-layer-process'),
      eyeLayerRespond: root.getElementById('eye-layer-respond'),
      eyeLayerDance: root.getElementById('eye-layer-dance'),
      eyeHalo: root.getElementById('eye-halo'),
      eyeCenter: root.getElementById('eye-center'),
      pupil: root.getElementById('eye-pupil'),
      eyeball: root.getElementById('eyeball-assembly'),
      bellows: root.getElementById('bellows'),
      lidTop: root.getElementById('eye-lid'),
      lidBot: root.getElementById('eye-lid-bottom'),
      dangerRing: root.getElementById('danger-ring'),
      progressRing: root.getElementById('progress-ring'),
      ledMatrices: root.querySelectorAll('.led-matrix'),
    };
    // Variant stacks (A1): the pre-painted circles inside #eye-center /
    // #eye-halo, keyed by their data attribute.
    this._centerVariants = [...root.querySelectorAll('.eye-center-variant')];
    this._haloVariants = [...root.querySelectorAll('.eye-halo-variant')];
    this._lastCenterColor = null;
    this._lastHaloFill = null;

    // LED custom-property targets: the ONLY consumers of --led-color /
    // --led-opacity are the .led-dot rects (inside the two .led-matrix
    // groups) and the four #ind-* circles. Writing the vars here instead of
    // on the SVG root keeps the custom-property invalidation scoped to these
    // six elements instead of the whole subtree.
    this.ledVarTargets = [
      ...root.querySelectorAll('.led-matrix'),
      root.getElementById('ind-l1'),
      root.getElementById('ind-l2'),
      root.getElementById('ind-r1'),
      root.getElementById('ind-r2'),
    ].filter(Boolean);
    this._lastLedColor = null;
    this._lastLedOpacity = null;
    this._lastLidAmount = null;
    this._lastLidDur = null;
    // Conduit pump guard (5.8.0): amount + duration are BOTH part of the
    // identity — the dance re-issues the same 0 px release on every offbeat
    // and the same N px compression on every downbeat, and both writes
    // (translate3d + transition) must be skipped when neither changes.
    this._lastBellowsAmount = null;
    this._lastBellowsDur = null;
    // LED telemetry class state (5.8.0). ONE class toggle per beat drives a
    // compositor-animated CSS keyframe sweep; the alternative — writing up to
    // 24 per-dot custom properties every beat — is 24 style recalcs on a weak
    // tablet CPU to paint the same picture.
    this._ledTelemetry = null;

    // Mutable visual state (read by bop save/restore, lid loop, etc.)
    this.currentBaseLid = 0;
    this.currentLedColor = '#ffb800';
    this.currentLedOpacity = '0.15';

    // Centralized resource registry: name -> timer/raf id
    this._timers = new Map();
    this._rafs = new Map();
  }

  // ---- Tracked scheduling (the ONLY way behaviors may schedule work) ----

  setTimeout(name, fn, delay) {
    this.clearTimeout(name);
    const id = setTimeout(() => {
      this._timers.delete(name);
      fn();
    }, delay);
    this._timers.set(name, id);
    return id;
  }

  clearTimeout(name) {
    const id = this._timers.get(name);
    if (id !== undefined) {
      clearTimeout(id);
      this._timers.delete(name);
    }
  }

  /**
   * Tracked RAF with the fps_max frame-budget gate (5.7.0-beta.3). The
   * callback fires at most 1000/fpsMax times per second; gated frames
   * re-arm under the SAME registry name so cancelRaf/stopAll teardown
   * semantics are unchanged (a cancel between gate frames kills the
   * chain cleanly). The REAL rAF timestamp is always forwarded — springs
   * integrate true elapsed dt, so visuals are pixel-identical.
   */
  requestRaf(name, fn) {
    this.cancelRaf(name);
    const id = requestAnimationFrame((now) => {
      this._rafs.delete(name);
      // Ungated fast path: no cap (or cap at/above any real display rate).
      if (this._fpsMax >= 240) { fn(now); return; }
      const budget = 1000 / this._fpsMax;
      if (this._lastGate === null) {
        // First tick after idle: fire immediately and anchor the grid.
        this._lastGate = now;
        fn(now);
        return;
      }
      const elapsed = now - this._lastGate;
      // 1ms epsilon: a 60 Hz display's frame timing (16.666ms) sits just
      // under the fps_max-60 budget (16.6667ms) — float jitter must never
      // drop frames when the display rate equals the cap.
      if (elapsed >= budget - 1) {
        // Advance the grid by whole budgets, clamped to `now`: the tick
        // grid never drifts (a 240 Hz display at fps_max 60 fires every
        // 4th frame, not slowly sliding), an early fire can never leave
        // the anchor a full period behind (which would double-fire), and
        // a long stall (hidden tab) resyncs in ONE tick instead of
        // bursting through the accumulated budget.
        const steps = Math.max(1, Math.floor(elapsed / budget));
        this._lastGate = Math.min(now, this._lastGate + steps * budget);
        fn(now);
      } else {
        // Budget not yet elapsed: re-arm silently under the same name.
        this.requestRaf(name, fn);
      }
    });
    this._rafs.set(name, id);
    return id;
  }

  cancelRaf(name) {
    const id = this._rafs.get(name);
    if (id !== undefined) {
      cancelAnimationFrame(id);
      this._rafs.delete(name);
    }
  }

  /** Tear down every tracked timer and RAF. */
  stopAll() {
    for (const id of this._timers.values()) clearTimeout(id);
    for (const id of this._rafs.values()) cancelAnimationFrame(id);
    this._timers.clear();
    this._rafs.clear();
    // Reset the fps_max gate anchor: the next motion loop must fire on its
    // first frame, not wait out a budget measured against a stale grid.
    this._lastGate = null;
    // Guards are per-LIVE-SESSION state. After a teardown the DOM is rebuilt
    // (config change) or the element re-attached, and the physical conduit /
    // lid / pupil may well be somewhere else — a surviving guard would then
    // skip the write that re-asserts them. Never carry them across.
    this._lastBellowsAmount = null;
    this._lastBellowsDur = null;
    this._ledTelemetry = null;
    this._lastLidAmount = null;
    this._lastLidDur = null;
    this._lastPupilX = null;
    this._lastPupilY = null;
  }

  // ---- Motion primitives (1:1 ports of the original initAxidos closures) ----
  // Transform writes go to ALL copies of a duplicated pivot group (layer
  // split C1/C2): the eye/LED layers carry mirror chains, and a write to
  // only the first copy would desync the layers.

  /**
   * Pose the head. NO redundant-write guard — deliberately, and do not add one.
   *
   * freezeHeadMotion() (tap bop) leaves the head with `transition: none` and an
   * inline mid-flight transform. The first post-bop write MUST restore the
   * transition even when the target is numerically identical to what is
   * already inline; a "skip identical transform" optimization here would skip
   * that restore and the head would stay frozen for the rest of the state.
   *
   * The separate 5.7.1 "dead bar" problem (a phrase that targets an unchanged
   * pose for many beats, so the browser has nothing to interpolate) is fixed
   * UPSTREAM in choreography.js via the living-hold breath, not here.
   *
   * 5.8.0 YAW (optional skew/scaleX): a scan can TURN the optic toward a
   * target instead of only tilting it. The optic is rigidly mounted, so this
   * is the housing yawing on its pivot — never the eye rotating inside the
   * socket. Both default to neutral and are APPENDED to the same single
   * transform string, so the write count per beat is unchanged. skewX is
   * clamped so the silhouette can never break the socket (see setHead's
   * caller contract in idle.js and the verify suite's clamp check).
   */
  setHead(rot, tx, ty, scale = 1.0, dur, ease = 'cubic-bezier(0.34,1.06,0.64,1)', skew = 0, scaleX = 1) {
    const yaw = (typeof skew === 'number' && Number.isFinite(skew))
      ? Math.max(-MAX_HEAD_SKEW, Math.min(MAX_HEAD_SKEW, skew)) : 0;
    const sx = (typeof scaleX === 'number' && Number.isFinite(scaleX)) ? scaleX : 1;
    // The neutral case must stay BYTE-IDENTICAL to the pre-5.8.0 transform
    // string: CSS transitions interpolate the parsed value, but a changed
    // string on an otherwise identical target still re-triggers the write,
    // and every pose in the phrase library passes skew 0 / scaleX 1.
    const tail = (yaw === 0 && sx === 1) ? '' : ` skewX(${yaw}deg) scaleX(${sx})`;
    for (const el of this.el.head) {
      el.style.transition = `transform ${dur}s ${ease}`;
      el.style.transform = `translate3d(${tx}px,${ty}px,0) rotate(${rot}deg) scale(${scale})${tail}`;
    }
  }

  setBodySwivel(rot, sx, dur) {
    for (const el of this.el.torsoSwivel) {
      el.style.transition = `transform ${dur || 2.0}s cubic-bezier(0.45,0.05,0.55,0.95)`;
      el.style.transform = `rotate(${rot}deg) scaleX(${sx || 1})`;
    }
  }

  resetBodySwivel() {
    for (const el of this.el.torsoSwivel) {
      el.style.transition = `transform 2.0s cubic-bezier(0.45,0.05,0.55,0.95)`;
      el.style.transform = '';
    }
  }

  setLid(amount, dur = 0.7) {
    // Redundant-write guard (mirrors setLedVars): identical amount+duration
    // skips all four style writes. The dance loop re-issues setBaseLid every
    // beat with a mostly-constant value — without this guard that is 4
    // unguarded writes per beat on two elements.
    if (amount === this._lastLidAmount && dur === this._lastLidDur) return;
    this._lastLidAmount = amount;
    this._lastLidDur = dur;
    const px = amount * 17;
    this.el.lidTop.style.transition = `transform ${dur}s ease-in-out`;
    this.el.lidBot.style.transition = `transform ${dur}s ease-in-out`;
    this.el.lidTop.style.transform = `translate3d(0, ${px}px, 0)`;
    this.el.lidBot.style.transform = `translate3d(0, ${-px}px, 0)`;
  }

  setBaseLid(amount, dur = 0.7) {
    this.currentBaseLid = amount;
    this.setLid(amount, dur);
  }

  setPupil(px, py) {
    // Redundant-write guard (mirrors setLid/setLedVars): the dance loop can
    // issue setPupil every beat (darts, syncopation accents) and each call
    // cascaded into THREE element writes (pupil, eyeball, bellows) — on a
    // weak tablet CPU that is 3 style recalcs per beat for no visual change
    // when the target is identical. Skip the whole cascade when unchanged.
    //
    // 5.8.0 DECOUPLING: gaze no longer moves the conduit. The old cascade
    // wrote #bellows (translate3d + transition) from here, so every pupil
    // change — dance darts, syncopation accents, idle scanning — compressed
    // the segmented flex conduit. That is physically wrong: the conduit is in
    // the vertical TRACK and compresses with RAIL TRAVEL, it is not attached
    // to the optic. It also cost two extra style writes per pupil change.
    // The conduit now has exactly ONE writer (setBellows, driven by the
    // choreography's pump channel), which makes the gaze/conduit decoupling
    // a verifiable invariant rather than a convention.
    if (px === this._lastPupilX && py === this._lastPupilY) return;
    this._lastPupilX = px;
    this._lastPupilY = py;
    this.el.pupil.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    this.el.eyeball.style.transform = `translate3d(0, ${py * 1.5}px, 0)`;
  }

  /**
   * Compress the segmented flex CONDUIT (#bellows inside #trackClip).
   *
   * `amount` is px of compression (positive = the ribs bunch upward). This is
   * NOT breathing and NOT a lung: the conduit is the flex column the head
   * carriage rides on, so it compresses with rail travel and releases as the
   * carriage settles. One guarded write per beat (full mode only).
   *
   * Guard: amount + duration are both part of the identity. The dance issues
   * N px on the downbeat and 0 px on every offbeat; without the guard that is
   * two writes on the same element every beat, and the 0 px release would
   * re-trigger a transition over an already-settled transform.
   *
   * `translate3d` rather than `scaleY` on purpose: the conduit is inside a
   * clipped <g> (#trackClip), and scaling clipped content re-rasterises the
   * whole rib stack on every write. At 1-5 px of travel the two are visually
   * indistinguishable and the translation stays on the compositor.
   */
  setBellows(amount, dur = 0.15) {
    if (amount === this._lastBellowsAmount && dur === this._lastBellowsDur) return;
    this._lastBellowsAmount = amount;
    this._lastBellowsDur = dur;
    this.el.bellows.style.transition = `transform ${dur}s ease-out`;
    this.el.bellows.style.transform = `translate3d(0, ${-amount}px, 0)`;
  }

  /**
   * LED telemetry class (5.8.0): ONE class toggle per beat. The class drives
   * a CSS keyframe opacity sweep (template.js) that the compositor animates —
   * the per-dot alternative is up to 24 custom-property writes per beat.
   * Guarded: the dance re-asserts the same class every beat.
   *
   * COST GATE — this is only acceptable while the class change is rare. The
   * measurement requirement is recorded in README/CHANGELOG: on the target
   * tablet, `debug_perf` must show the worst-frame and jank counts unchanged
   * against the 5.7.2 baseline. If a future beat pattern toggles this class
   * more than once per beat, it is no longer a compositor animation and the
   * telemetry must be dropped rather than made per-dot.
   */
  setLedTelemetry(mode) {
    const cls = mode ? `telemetry-${mode}` : null;
    if (cls === this._ledTelemetry) return;
    this._ledTelemetry = cls;
    for (const el of this.ledVarTargets) {
      el.classList.remove('telemetry-scan', 'telemetry-burst');
      if (cls) el.classList.add(cls);
    }
  }

  /**
   * Freeze all in-flight head/torso motion so a tap bop owns the head
   * exclusively. Snapshots the live computed transforms of #axidos-head and
   * #torso-swivel into their inline styles with transition disabled —
   * halting any running CSS transition mid-flight. ALL copies are frozen
   * from their OWN computed transform (each layer's mirror must stay
   * registered with its layer's chain).
   *
   * Used by the tap bop: pausing the idle scheduler or holding the dance
   * only stops NEW moves; without this freeze, an in-flight pose transition
   * keeps animating the head while the bop spring bounces the #head-bop
   * layer — two animations fighting over the same visual.
   */
  freezeHeadMotion() {
    for (const el of [...this.el.head, ...this.el.torsoSwivel]) {
      if (!el) continue;
      try {
        const t = getComputedStyle(el).transform;
        if (t && t !== 'none') {
          el.style.transition = 'none';
          el.style.transform = t;
        } else {
          el.style.transition = 'none';
        }
      } catch (err) { /* stub environments */ }
    }
  }

  /**
   * Ease-clear the bop layer transform (tap-bop spring layer on the head).
   * A short transition lets any residual displacement glide back to neutral
   * instead of snapping when the bop ends or a state change tears it down.
   * Written to ALL #head-bop copies (head + eye layers).
   */
  resetBopLayer() {
    for (const el of this.el.headBop) {
      el.style.transition = 'transform 0.4s ease-out';
      el.style.transform = 'translate3d(0,0,0) rotate(0deg) scale(1)';
    }
  }

  /**
   * Crossfade the #eye-center variant stack to `color` (A1): the incoming
   * variant's opacity 0→1 and the outgoing 1→0 are written in the SAME
   * frame — never a sequential swap (both mid-flight = paint flash).
   * Out-of-set colors write the fill directly on the 'dynamic' fallback
   * variant and toggle its opacity. Redundant-write guarded.
   */
  setEyeCenterColor(color) {
    if (color === this._lastCenterColor) return;
    this._lastCenterColor = color;
    this._crossfadeVariants(this._centerVariants, 'data-color', color, EYE_CENTER_VARIANTS);
  }

  /** Same concurrent-crossfade contract for the #eye-halo variant stack. */
  setEyeHaloFill(fill) {
    if (fill === this._lastHaloFill) return;
    this._lastHaloFill = fill;
    this._crossfadeVariants(this._haloVariants, 'data-fill', fill, EYE_HALO_VARIANTS);
  }

  /**
   * Shared A1 crossfade: one frame, two opacity writes (in 0→1 + out 1→0).
   * The CSS opacity transition (0.8s, template.js) interpolates both
   * concurrently. Unknown values ride the 'dynamic' fallback variant.
   */
  _crossfadeVariants(variants, dataAttr, value, knownSet) {
    if (!variants || variants.length === 0) return;
    const known = knownSet.includes(value);
    for (const v of variants) {
      const isTarget = v.getAttribute(dataAttr) === value;
      const isDynamic = v.getAttribute(dataAttr) === 'dynamic';
      if (isTarget) {
        v.style.opacity = '1';
      } else if (isDynamic) {
        // Fallback variant: only active when the value is out of set.
        if (!known) v.setAttribute('fill', value);
        v.style.opacity = known ? '0' : '1';
      } else {
        v.style.opacity = '0';
      }
    }
  }

  /**
   * Write the LED custom properties ONLY on the consumer elements (matrix
   * groups + indicator dots) — never on the SVG root, where a write would
   * invalidate the entire subtree. Skips the writes entirely when both
   * values are unchanged since the last call.
   */
  setLedVars(color, opacity) {
    if (color === this._lastLedColor && opacity === this._lastLedOpacity) return;
    this._lastLedColor = color;
    this._lastLedOpacity = opacity;
    for (const el of this.ledVarTargets) {
      el.style.setProperty('--led-color', color);
      el.style.setProperty('--led-opacity', opacity);
    }
  }

  setLEDs(color, opacity) {
    this.currentLedColor = color;
    this.currentLedOpacity = opacity;
    this.setLedVars(color, opacity);
  }
}