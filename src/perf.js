/**
 * perf.js — Opt-in on-card performance diagnostics (5.8.0).
 *
 * Devices without developer tools (Android WebView / View Assist Companion
 * App) have no console, so the card itself becomes the logger: a small HUD
 * overlay renders live FPS, jank-frame counts, and dance beat-timer lateness
 * directly on the card — readable on the tablet screen itself.
 *
 * ZERO COST when disabled: the card only constructs a PerfMonitor when
 * config.debug_perf is true. When enabled the sampler is a single RAF loop
 * (one wakeup per frame, no DOM writes between HUD refreshes) and the HUD
 * text is updated at most twice per second.
 *
 * Metrics:
 *  - fps:        rolling 2-second frame rate from the RAF sampler.
 *  - jank:       frames slower than 50ms since HUD start (cumulative).
 *  - worst:      slowest single frame since the last HUD refresh (ms).
 *  - beat late:  dance beat-timer lateness (now − expectedNextTick at tick
 *                fire time) — min/avg/max over a rolling 32-beat window.
 *                This is the direct probe for the "skips a beat and catches
 *                up" feel: a late timer means the main thread was busy and
 *                the pose fired off-grid.
 *
 * The monitor is passive: it never alters animation behavior. dance.js
 * reports lateness through recordBeatLateness() (a no-op when absent).
 */

const JANK_THRESHOLD_MS = 50;
const HUD_REFRESH_MS = 500;
const BEAT_WINDOW = 32;

export class PerfMonitor {
  /**
   * @param {ShadowRoot} shadowRoot - the card's shadow root (HUD appended here)
   * @param {HTMLElement} host - the card host element (for size context)
   */
  constructor(shadowRoot) {
    this._shadow = shadowRoot;
    this._rafId = null;
    this._lastFrame = null;
    this._frameCount = 0;
    this._windowStart = null;
    this._fps = 0;
    this._jankCount = 0;
    this._worstFrame = 0;
    this._beatLates = [];   // rolling window of beat lateness (ms)
    this._hudTimer = null;

    // HUD overlay: absolutely positioned in the card's top-left corner,
    // pointer-events none so it never blocks taps, monospace for stable
    // digit widths. Styled inline — it must not depend on template CSS.
    const hud = document.createElement('div');
    hud.className = 'axidos-perf-hud';
    hud.setAttribute('part', 'perf-hud');
    hud.style.cssText = [
      'position:absolute',
      'top:2px',
      'left:2px',
      'z-index:10',
      'pointer-events:none',
      'font:10px/1.35 monospace',
      'color:#7fff7f',
      'background:rgba(0,0,0,0.55)',
      'padding:3px 6px',
      'border-radius:4px',
      'white-space:pre',
      'text-align:left',
    ].join(';');
    hud.textContent = 'perf: starting…';
    shadowRoot.appendChild(hud);
    this._hud = hud;

    this._start();
  }

  // ---- Beat-lateness probe (called from dance.js executeTick) ----

  /** Record one beat-timer lateness sample (ms late; clamped ≥ 0). */
  recordBeatLateness(lateMs) {
    if (typeof lateMs !== 'number' || !Number.isFinite(lateMs)) return;
    this._beatLates.push(Math.max(0, lateMs));
    if (this._beatLates.length > BEAT_WINDOW) this._beatLates.shift();
  }

  // ---- Frame sampler ----

  _start() {
    const sample = (now) => {
      if (this._lastFrame !== null) {
        const dt = now - this._lastFrame;
        this._frameCount++;
        if (dt > JANK_THRESHOLD_MS) this._jankCount++;
        if (dt > this._worstFrame) this._worstFrame = dt;
        if (this._windowStart === null) this._windowStart = now;
        else if (now - this._windowStart >= 2000) {
          this._fps = Math.round((this._frameCount * 1000) / (now - this._windowStart));
          this._frameCount = 0;
          this._windowStart = now;
        }
      }
      this._lastFrame = now;
      this._rafId = requestAnimationFrame(sample);
    };
    this._rafId = requestAnimationFrame(sample);

    this._hudTimer = setInterval(() => this._renderHud(), HUD_REFRESH_MS);
  }

  _renderHud() {
    let beatLine = 'beat late: —';
    if (this._beatLates.length > 0) {
      const arr = this._beatLates;
      const sum = arr.reduce((s, v) => s + v, 0);
      const min = Math.round(Math.min(...arr));
      const max = Math.round(Math.max(...arr));
      const avg = Math.round(sum / arr.length);
      beatLine = `beat late: ${min}/${avg}/${max} ms`;
    }
    this._hud.textContent =
      `fps: ${this._fps}  jank: ${this._jankCount}  worst: ${Math.round(this._worstFrame)}ms\n${beatLine}`;
    this._worstFrame = 0;
  }

  /** Stop the sampler and remove the HUD. */
  destroy() {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    if (this._hudTimer !== null) clearInterval(this._hudTimer);
    this._hudTimer = null;
    if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud);
    this._hud = null;
  }
}