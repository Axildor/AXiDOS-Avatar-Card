/**
 * axidos-card.js — AxidosCard: thin lifecycle orchestrator.
 *
 * Owns: config lifecycle, hass state diffing, DOM setup, tap/keyboard
 * handlers, visibility handling, and WebKit reflow fix. All animation work
 * is delegated to AxidosAnimator + behavior modules via states.js.
 */

import { sanitizeConfig, getStubConfig } from './config.js';
import { buildEditorForm } from './editor.js';
import { resolveState, parseBpm, parseProgress } from './state-mapper.js';
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

  set hass(hass) {
    if (!hass) return;
    this._hass = hass;
    if (!this.contentReady) {
      this.setupDOM();
      this.initAxidos();
      this.contentReady = true;
    }
    const entity = this.config.entity;
    const mediaEntity = this.config.media_entity;
    const bpmEntity = this.config.bpm_entity;
    const progressEntity = this.config.progress_entity;
    const newVoiceState = (entity && hass.states[entity]) ? hass.states[entity].state.toLowerCase() : 'idle';
    const newMediaState = (mediaEntity && hass.states[mediaEntity]) ? hass.states[mediaEntity].state.toLowerCase() : 'paused';
    const newBpmState = (bpmEntity && hass.states[bpmEntity]) ? hass.states[bpmEntity].state : '120';
    const newProgressState = (progressEntity && hass.states[progressEntity]) ? hass.states[progressEntity].state : null;

    // Firehose gatekeeping: only react when a tracked entity actually changed
    if (this._lastHassVoice === newVoiceState && this._lastHassMedia === newMediaState && this._lastHassBpm === newBpmState && this._lastHassProgress === newProgressState) return;

    this._lastHassVoice = newVoiceState;
    this._lastHassMedia = newMediaState;
    this._lastHassBpm = newBpmState;
    this._lastHassProgress = newProgressState;

    // Progress sensor: parse + cache on every tracked change. A percentage
    // change while idle updates the ring in place (lightweight, no behavior
    // restart); in any other state the ring is hidden and the value is just
    // cached for the next idle entry.
    const prevProgress = this._progressPct;
    this._progressPct = parseProgress(newProgressState);
    if (this._state === 'idle' && this._progressPct !== prevProgress) {
      updateProgressRing(this);
    }

    const currentBpm = parseBpm(newBpmState);
    const mapped = resolveState(newVoiceState, newMediaState);

    if (this._state !== mapped) {
      this._currentBpm = currentBpm;
      applyState(this, mapped, currentBpm);
    } else if (mapped === 'dancing' && this._currentBpm !== currentBpm) {
      // BPM hysteresis: a same-tier BPM change retunes the beat clock IN
      // PLACE (dancePhase/phraseId/phraseCount preserved — no visible
      // restart, so sensor jitter cannot flicker the choreography). A
      // cross-tier change (crossing 90/125/160 BPM) swaps the phrase
      // library, which requires a full restart.
      this._currentBpm = currentBpm;
      const retuned = typeof this._retuneDance === 'function' && this._retuneDance(currentBpm);
      if (!retuned) applyState(this, mapped, currentBpm);
    }
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