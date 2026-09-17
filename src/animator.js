/**
 * animator.js — AxidosAnimator: element refs + motion primitives + resource registry.
 *
 * This class owns every DOM reference and every motion primitive. Behavior
 * modules (idle/dance/talk/bop) drive the SVG exclusively through this class,
 * and MUST schedule timers/RAFs through the tracked helpers so that
 * stopAll() can guarantee zero leaks on teardown or state change.
 */

export class AxidosAnimator {
  constructor(shadowRoot) {
    const root = shadowRoot;
    this.el = {
      svg: root.getElementById('axidos-svg'),
      head: root.getElementById('axidos-head'),
      headBop: root.getElementById('head-bop'),
      torsoSwivel: root.getElementById('torso-swivel'),
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

  requestRaf(name, fn) {
    this.cancelRaf(name);
    const id = requestAnimationFrame((now) => {
      this._rafs.delete(name);
      fn(now);
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
  }

  // ---- Motion primitives (1:1 ports of the original initAxidos closures) ----

  setHead(rot, tx, ty, scale = 1.0, dur, ease = 'cubic-bezier(0.34,1.06,0.64,1)') {
    this.el.head.style.transition = `transform ${dur}s ${ease}`;
    this.el.head.style.transform = `translate3d(${tx}px,${ty}px,0) rotate(${rot}deg) scale(${scale})`;
  }

  setBodySwivel(rot, sx, dur) {
    this.el.torsoSwivel.style.transition = `transform ${dur || 2.0}s cubic-bezier(0.45,0.05,0.55,0.95)`;
    this.el.torsoSwivel.style.transform = `rotate(${rot}deg) scaleX(${sx || 1})`;
  }

  resetBodySwivel() {
    this.el.torsoSwivel.style.transition = `transform 2.0s cubic-bezier(0.45,0.05,0.55,0.95)`;
    this.el.torsoSwivel.style.transform = '';
  }

  setLid(amount, dur = 0.7) {
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
   * halting any running CSS transition mid-flight.
   *
   * Used by the tap bop: pausing the idle scheduler or holding the dance
   * only stops NEW moves; without this freeze, an in-flight pose transition
   * keeps animating the head while the bop spring bounces the #head-bop
   * layer — two animations fighting over the same visual.
   */
  freezeHeadMotion() {
    for (const el of [this.el.head, this.el.torsoSwivel]) {
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
   */
  resetBopLayer() {
    if (this.el.headBop) {
      this.el.headBop.style.transition = 'transform 0.4s ease-out';
      this.el.headBop.style.transform = 'translate3d(0,0,0) rotate(0deg) scale(1)';
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