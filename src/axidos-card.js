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
import { buildTemplate } from './template.js';
import { AxidosAnimator } from './animator.js';
import { applyState, updateProgressRing } from './states.js';
import { bopHead } from './behaviors/bop.js';

export class AxidosCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._lastHassVoice = null;
    this._lastHassMedia = null;
    this._lastHassBpm = null;
    this._lastHassProgress = null;
    this._progressPct = null;
    this._state = 'idle';
    this._currentBpm = 120;
    this._bopping = false;
    this._bopSpring = null;
    this.animator = null;
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
      applyState(this, prevState || 'idle', this._currentBpm);
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

  // Double rAF Kinetic Reflow completely flushes frozen WebKit SVG timelines
  connectedCallback() {
    if (this._boundVisibility) {
      document.addEventListener('visibilitychange', this._boundVisibility);
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
        applyState(this, this._state, this._currentBpm);
      }
    }
  }

  disconnectedCallback() {
    if (this._hitbox) {
      if (this._tapHandler) this._hitbox.removeEventListener('click', this._tapHandler);
      if (this._keyHandler) this._hitbox.removeEventListener('keydown', this._keyHandler);
    }
    this._teardownAnimation();
    if (this._boundVisibility) {
      document.removeEventListener('visibilitychange', this._boundVisibility);
    }
  }

  setupDOM() {
    this.shadowRoot.innerHTML = buildTemplate(this.config);
  }

  initAxidos() {
    this.animator = new AxidosAnimator(this.shadowRoot);
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
        this.animator.el.svg.style.animationPlayState = 'paused';
        this.animator.el.svg.querySelectorAll('#body-pivot, #head-sway-pivot').forEach((e) => { e.style.animationPlayState = 'paused'; });
      } else {
        this.animator.el.svg.style.animationPlayState = '';
        this.animator.el.svg.querySelectorAll('#body-pivot, #head-sway-pivot').forEach((e) => { e.style.animationPlayState = ''; });
        applyState(this, this._state, this._currentBpm || 120);
      }
    };

    if (this._boundVisibility) document.removeEventListener('visibilitychange', this._boundVisibility);
    this._boundVisibility = this._visibilityHandler;
    document.addEventListener('visibilitychange', this._boundVisibility);

    applyState(this, 'idle', 120);
  }
}