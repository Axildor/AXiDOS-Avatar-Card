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
  }

  // ---- Motion primitives (1:1 ports of the original initAxidos closures) ----
  // Transform writes go to ALL copies of a duplicated pivot group (layer
  // split C1/C2): the eye/LED layers carry mirror chains, and a write to
  // only the first copy would desync the layers.

  setHead(rot, tx, ty, scale = 1.0, dur, ease = 'cubic-bezier(0.34,1.06,0.64,1)') {
    for (const el of this.el.head) {
      el.style.transition = `transform ${dur}s ${ease}`;
      el.style.transform = `translate3d(${tx}px,${ty}px,0) rotate(${rot}deg) scale(${scale})`;
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
    // cascades into THREE element writes (pupil, eyeball, bellows) — on a
    // weak tablet CPU that is 3 style recalcs per beat for no visual change
    // when the target is identical. Skip the whole cascade when unchanged.
    if (px === this._lastPupilX && py === this._lastPupilY) return;
    this._lastPupilX = px;
    this._lastPupilY = py;
    this.el.pupil.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    const ey = py * 1.5;
    this.el.eyeball.style.transform = `translate3d(0, ${ey}px, 0)`;
    this._pupilBellowsY = ey;
    this._applyBellows(0.15);
  }

  /**
   * Pump the bellows: amount in px (positive = compress upward). Composes
   * with the pupil-driven bellows offset so the two don't clobber each other.
   */
  setBellows(amount, dur = 0.15) {
    this._bellowsPump = amount;
    this._applyBellows(dur);
  }

  _applyBellows(dur) {
    this.el.bellows.style.transition = `transform ${dur}s ease-out`;
    this.el.bellows.style.transform = `translate3d(0, ${(this._pupilBellowsY || 0) - (this._bellowsPump || 0)}px, 0)`;
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