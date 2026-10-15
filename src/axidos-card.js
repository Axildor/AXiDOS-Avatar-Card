/**
 * axidos-card.js — AxidosCard: thin lifecycle orchestrator.
 *
 * Owns: config lifecycle, hass state diffing, DOM setup, tap/keyboard
 * handlers, visibility handling, and WebKit reflow fix. All animation work
 * is delegated to AxidosAnimator + behavior modules via states.js.
 */

import { sanitizeConfig, getStubConfig } from './config.js';
import { buildEditorForm } from './editor.js';
import { applyHassUpdate } from './hass-update.js';
import { buildTemplate, auditCrossSvgDefs } from './template.js';
import { AxidosAnimator } from './animator.js';
import { applyState, updateProgressRing } from './states.js';
import { bopHead } from './behaviors/bop.js';
import { PerfMonitor } from './perf.js';

export class AxidosCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastHassVoice = null;
    this._lastHassMedia = null;
    this._lastHassBpm = null;
    this._lastHassProgress = null;
    this._lastHassMood = null;
    this._progressPct = null;
    this._state = 'idle';
    this._currentBpm = 120;
    this._currentMood = null;
    this._bopping = false;
    this._bopSpring = null;
    this.animator = null;
    this.perf = null;
    this._offscreen = false;
    this._intersectionObserver = null;
    this.contentReady = false;
  }

  // Native HA form editor: HA renders <ha-form> from this schema (same
  // mechanism mushroom cards use). Schema + labels live in editor.js.
  static getConfigForm() { return buildEditorForm(); }
  static getStubConfig() { return getStubConfig(); }

  setConfig(config) {
    this.config = sanitizeConfig(config);

    if (this.contentReady) {
      const prevState = this._state;
      this._teardownAnimation();
      this.setupDOM();
      this.initAxidos();
      applyState(this, prevState || 'idle', this._currentBpm, this._currentMood);
      // Re-render the ring after a config change (entity swap, color toggles)
      // — applyState only renders it in idle, so force a refresh here too.
      updateProgressRing(this);
    }
  }

  // The full delivery pipeline (firehose gate, self-healing sync check,
  // progress parsing, state application with exception protection) lives in
  // hass-update.js — extracted so the verify suites can drive real deliveries
  // through the exact production code path.
  set hass(hass) {
    applyHassUpdate(this, hass);
  }

  getCardSize() {
    const zoom = this.config?.zoom ?? 85;
    return Math.max(6, Math.ceil(6 * (zoom / 100)));
  }

  getGridOptions() {
    const zoom = this.config?.zoom ?? 85;
    const scale = zoom / 100;
    // Sections-view row math: 56px row + 24px gap → slot height = 80·rows − 24.
    // Size the slot to fit the zoomed 320px-tall scene so zoom > 100 grows the
    // card instead of clipping the scene and shifting the model downward.
    // zoom 85 → 4 rows (default), zoom 100 → 5, zoom 200 → 9.
    const rows = Math.max(4, Math.ceil((320 * scale + 24) / 80));
    // Columns must grow with zoom too: the scene is 280px × scale wide, and
    // the SVG's preserveAspectRatio caps the model's scale to the slot width.
    // A fixed 6-column slot flex-shrinks the scene back down at zoom > 100,
    // pinning the model at ~100% while the extra rows add empty space.
    // zoom 85 → 6 columns (default), zoom 120 → 7, zoom 200 → 12.
    const columns = Math.min(12, Math.max(6, Math.round(6 * scale)));
    return { rows, min_rows: 2, columns, min_columns: 4, max_columns: 12 };
  }

  /** Stop all animation resources (timers, RAFs, bop flag + spring). */
  _teardownAnimation() {
    if (this.animator) this.animator.stopAll();
    this._bopping = false;
    this._bopSpring = null;
  }

  /**
   * Offscreen pause (5.8.0): an IntersectionObserver on the host stops ALL
   * behavior engines when the card scrolls out of the dashboard viewport and
   * re-applies the current state on re-entry. Mirrors the document.hidden
   * handler below — on a tablet dashboard the card can sit offscreen in a
   * long view while the (weak) CPU keeps paying for its full animation
   * budget. Threshold 0.05 = any meaningful visibility counts as onscreen;
   * the observer is only attached when IntersectionObserver exists (all
   * modern WebViews do; the guard keeps stub environments safe).
   */
  _setupOffscreenPause() {
    if (typeof IntersectionObserver !== 'function') return;
    if (this._intersectionObserver) this._intersectionObserver.disconnect();
    this._intersectionObserver = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (!this.isConnected || !this.contentReady) return;
      if (!visible && !this._offscreen) {
        this._offscreen = true;
        this._teardownAnimation();
        this._setSwayPaused('paused');
      } else if (visible && this._offscreen) {
        this._offscreen = false;
        this._setSwayPaused('');
        applyState(this, this._state, this._currentBpm || 120, this._currentMood);
      }
    }, { threshold: 0.05 });
    this._intersectionObserver.observe(this);
  }

  /**
   * Pause/resume the ambient sway keyframes across ALL mover layers (layer
   * split): the pivot copies live in every layer, and pausing only the first
   * would desync the stack. Also the A4 freeze fixture: the pixel-diff
   * harness calls this with 'paused' (plus _teardownAnimation) to freeze all
   * motion for static-frame captures.
   * @param {string} state - 'paused' or ''
   */
  _setSwayPaused(state) {
    if (!this.animator) return;
    for (const svg of this.animator.el.svgs) {
      svg.querySelectorAll('#body-pivot, #head-sway-pivot').forEach((e) => { e.style.animationPlayState = state; });
    }
  }

  // Double rAF Kinetic Reflow completely flushes frozen WebKit SVG timelines
  connectedCallback() {
    if (this._boundVisibility) {
      document.addEventListener('visibilitychange', this._boundVisibility);
    }
    // Re-arm the offscreen observer on every re-attach (HA's renderer
    // detaches/re-attaches card elements without recreating them).
    this._setupOffscreenPause();
    // Recreate the perf HUD if it was destroyed on disconnect (the HUD
    // element itself was removed with the sampler).
    if (this.contentReady && this.config?.debug_perf === true && !this.perf) {
      this.perf = new PerfMonitor(this.shadowRoot, this.config);
    }
    // Reset the raw-state caches: HA's renderer (sections, lazy load, edit
    // mode) detaches and re-attaches card elements without recreating them.
    // Stale caches from before the detach would gate the next hass delivery
    // via the firehose check — clearing them forces a full re-evaluation of
    // the current entity states on the next set hass() call.
    this._lastHassVoice = null;
    this._lastHassMedia = null;
    this._lastHassBpm = null;
    this._lastHassProgress = null;
    this._lastHassMood = null;
    if (this.contentReady) {
      // Re-attach tap/keyboard handlers: HA's renderer (sections, lazy load,
      // edit mode) detaches and re-attaches card elements without recreating
      // them, and disconnectedCallback() removed the listeners. addEventListener
      // dedupes identical function references, so this is safe on every connect.
      if (this._hitbox) {
        if (this._tapHandler) this._hitbox.addEventListener('click', this._tapHandler);
        if (this._keyHandler) this._hitbox.addEventListener('keydown', this._keyHandler);
      }
      const pivots = this.shadowRoot.querySelectorAll('#body-pivot, #head-sway-pivot');
      pivots.forEach((p) => { p.style.animation = 'none'; });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pivots.forEach((p) => { p.style.animation = ''; });
        });
      });
      if (this._state) {
        applyState(this, this._state, this._currentBpm, this._currentMood);
      }
    }
  }

  disconnectedCallback() {
    if (this._hitbox) {
      if (this._tapHandler) this._hitbox.removeEventListener('click', this._tapHandler);
      if (this._keyHandler) this._hitbox.removeEventListener('keydown', this._keyHandler);
    }
    this._teardownAnimation();
    // Stop the perf sampler while detached (its RAF would keep firing);
    // connectedCallback recreates it if debug_perf is on.
    if (this.perf) { this.perf.destroy(); this.perf = null; }
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
    this._offscreen = false;
    if (this._boundVisibility) {
      document.removeEventListener('visibilitychange', this._boundVisibility);
    }
  }

  setupDOM() {
    const tpl = buildTemplate(this.config);
    this.shadowRoot.innerHTML = tpl;
    // A3c defs audit: every url(#…) reference in the mover layers must
    // resolve inside the backdrop defs host (cross-SVG references resolve
    // document-wide for inline SVGs — PoC-validated). If the audit ever
    // trips (a browser build resolving per-SVG), the per-layer defs
    // duplication fallback injects a defs copy into every mover layer
    // AUTOMATICALLY rather than failing silently.
    const missing = auditCrossSvgDefs(tpl);
    if (missing.length > 0) {
      console.warn('axidos-card: cross-SVG defs unresolved, injecting per-layer copies:', missing);
      const backdrop = this.shadowRoot.getElementById('axidos-svg-backdrop');
      const defs = backdrop ? backdrop.querySelector('defs') : null;
      if (defs) {
        for (const svg of this.shadowRoot.querySelectorAll('svg.axidos-layer:not(#axidos-svg-backdrop)')) {
          svg.insertBefore(defs.cloneNode(true), svg.firstChild);
        }
      }
    }
    // dprfix RETIRED (5.7.0-beta.3, A2): the crbug 449095626 scale wrapper
    // was falsified on the Tab S6 Lite field test and the layer split makes
    // it meaningless (5 stacked layers, not one scalable SVG). The config
    // key stays accepted for backward compatibility but is a no-op; the
    // retirement notice fires once per setup so a stale config is visible
    // in the console.
    if (this.config.debug_dprfix === true) {
      console.info('axidos-card: debug_dprfix is retired (no-op) since 5.7.0-beta.3 — the layer split replaced the single-SVG compositing path.');
    }
    // Perf HUD (5.8.0): opt-in on-card diagnostics for devices without
    // developer tools. Destroyed and rebuilt with the DOM so a config change
    // (debug_perf toggle) always reflects the current setting.
    if (this.perf) { this.perf.destroy(); this.perf = null; }
    if (this.config.debug_perf === true) {
      this.perf = new PerfMonitor(this.shadowRoot, this.config);
    }
  }

  initAxidos() {
    // fps_max (5.7.0-beta.3): the JS motion frame cap — requestRaf gates all
    // tracked motion loops to this rate (default 60, clamped 30–240 in
    // sanitizeConfig). Springs are dt-based, so visuals are unchanged.
    this.animator = new AxidosAnimator(this.shadowRoot, this.config?.fps_max ?? 60);
    this._hitbox = this.animator.el.hitbox;

    // ---- Tap handler: bop + official native HA Lovelace action dispatch ----
    if (this._tapHandler && this._hitbox) {
      this._hitbox.removeEventListener('click', this._tapHandler);
    }
    this._tapHandler = (e) => {
      if (this.config.tap_enabled === false) return;
      e.stopPropagation();
      e.preventDefault();

      // Guarded: an animation failure must never block the action dispatch.
      try { bopHead(this); } catch (err) { console.warn('axidos-card: bop failed', err); }

      const actionObj = this.config.tap_action || { action: 'none' };
      if (actionObj.action === 'none') return;

      const ev = new Event('hass-action', { bubbles: true, composed: true });
      ev.detail = {
        config: this.config,
        action: 'tap',
      };
      this.dispatchEvent(ev);
    };

    if (this.config.tap_enabled !== false) { this._hitbox.style.display = 'block'; }
    this._hitbox.addEventListener('click', this._tapHandler);

    // ---- Keyboard accessibility ----
    if (this._keyHandler && this._hitbox) {
      this._hitbox.removeEventListener('keydown', this._keyHandler);
    }
    this._keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        if (e.key === ' ') e.preventDefault();
        this._tapHandler(e);
      }
    };
    this._hitbox.addEventListener('keydown', this._keyHandler);

    // ---- Tab visibility: pause everything when hidden, resume when visible ----
    this._visibilityHandler = () => {
      if (!this.isConnected) return;
      if (document.hidden) {
        this._teardownAnimation();
        this._setSwayPaused('paused');
      } else {
        this._setSwayPaused('');
        applyState(this, this._state, this._currentBpm || 120, this._currentMood);
      }
    };

    if (this._boundVisibility) document.removeEventListener('visibilitychange', this._boundVisibility);
    this._boundVisibility = this._visibilityHandler;
    document.addEventListener('visibilitychange', this._boundVisibility);

    applyState(this, 'idle', 120);
  }
}