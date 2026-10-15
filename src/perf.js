/**
 * perf.js — Opt-in on-card performance diagnostics (5.8.0; extended
 * 5.7.0-beta.1).
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
 *  - build:      CARD_VERSION echo — the loaded build is directly verifiable
 *                on the tablet (HA serves /hacsfiles/... with no
 *                cache-busting; WebView holds the file aggressively, so an
 *                in-place overwrite can leave clients silently on the old
 *                build — indistinguishable from "fix didn't work").
 *  - dpr:        devicePixelRatio, read LIVE at each HUD refresh (not
 *                captured once) — the crbug 449095626 variable.
 *  - heap:       usedJSHeapSize in MB (Chromium-only performance.memory,
 *                guarded; renders n/a elsewhere). GC stalls show up as
 *                160ms-class worst frames with a heap sawtooth.
 *  - flags:      the resolved debug-flag state (perf/lite/dprfix) so the
 *                tester can confirm which config the device is running.
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

import { CARD_VERSION } from './version.js';

const JANK_THRESHOLD_MS = 50;
const HUD_REFRESH_MS = 500;
const BEAT_WINDOW = 32;
// Heap-slope window (5.7.0-beta.2, HUD v2.1): 120 samples at the 500ms HUD
// refresh = a rolling 60s window. The slope distinguishes leak-shaped growth
// (steady positive MB/min) from a GC seesaw at a high plateau (slope ≈ 0,
// sawtooth visible in the raw value) in one glance.
const HEAP_WINDOW = 120;

export class PerfMonitor {
  /**
   * @param {ShadowRoot} shadowRoot - the card's shadow root (HUD appended here)
   * @param {Object} [config] - sanitized card config (for the flags line)
   */
  constructor(shadowRoot, config = {}) {
    this._shadow = shadowRoot;
    this._config = config;
    this._rafId = null;
    this._lastFrame = null;
    this._frameCount = 0;
    this._windowStart = null;
    this._fps = 0;
    this._jankCount = 0;
    this._worstFrame = 0;
    this._beatLates = [];   // rolling window of beat lateness (ms)
    this._heapSamples = []; // rolling (t, usedJSHeapSize) pairs for the slope
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

  // Processing gate (5.7.0-beta.3): the sampler still COUNTS every RAF frame
  // (fps/jank/worst must measure the true display rate — the crbug
  // compositing investigation depends on it), but the window-close branch
  // only runs at most every PROCESS_INTERVAL_MS (≤30 Hz). The 2 s stat
  // windows are wall-clock based, so the fps value stays statistically
  // valid — the window just closes on a processing tick instead of every
  // frame.
  static PROCESS_INTERVAL_MS = 33;

  _start() {
    const sample = (now) => {
      if (this._lastFrame !== null) {
        const dt = now - this._lastFrame;
        this._frameCount++;
        if (dt > JANK_THRESHOLD_MS) this._jankCount++;
        if (dt > this._worstFrame) this._worstFrame = dt;
        // ≤30 Hz processing gate: window bookkeeping only when due.
        if (now - this._lastProcess >= PerfMonitor.PROCESS_INTERVAL_MS) {
          this._lastProcess = now;
          if (this._windowStart === null) this._windowStart = now;
          else if (now - this._windowStart >= 2000) {
            this._fps = Math.round((this._frameCount * 1000) / (now - this._windowStart));
            this._frameCount = 0;
            this._windowStart = now;
          }
        }
      }
      this._lastFrame = now;
      this._rafId = requestAnimationFrame(sample);
    };
    this._lastProcess = 0;
    this._rafId = requestAnimationFrame(sample);

    this._hudTimer = setInterval(() => this._renderHud(), HUD_REFRESH_MS);
  }

  /**
   * Δheap/min over the rolling 60s window (HUD v2.1): least-squares slope of
   * usedJSHeapSize vs time, in MB/min. Returns null when performance.memory
   * is unavailable or fewer than 2 samples exist (slope undefined).
   */
  _heapSlope() {
    if (typeof performance === 'undefined' || !performance.memory
      || typeof performance.memory.usedJSHeapSize !== 'number') return null;
    const s = this._heapSamples;
    if (s.length < 2) return null;
    // Least squares over (x = seconds, y = MB): slope = cov(x,y)/var(x).
    const n = s.length;
    const xs = s.map((p) => p.t / 1000);
    const ys = s.map((p) => p.heap / 1048576);
    const mx = xs.reduce((a, v) => a + v, 0) / n;
    const my = ys.reduce((a, v) => a + v, 0) / n;
    let cov = 0; let varx = 0;
    for (let i = 0; i < n; i++) { cov += (xs[i] - mx) * (ys[i] - my); varx += (xs[i] - mx) ** 2; }
    if (varx === 0) return null;
    return (cov / varx) * 60; // seconds → minutes
  }

  /** Resolved debug-flag state for the HUD flags line. */
  _flagsLine() {
    const cfg = this._config || {};
    const perf = cfg.debug_perf === true;
    const lite = cfg.debug_lite === true;
    // dprfix RETIRED (5.7.0-beta.3): the crbug 449095626 scale wrapper was
    // falsified on device and the layer split replaced the single-SVG
    // compositing path. The key stays accepted but is a no-op — the HUD
    // shows "retired" so a stale config is identifiable on the tablet.
    const dprfix = cfg.debug_dprfix === true ? 'retired (no-op)' : 'off';
    const fpsMax = (typeof cfg.fps_max === 'number' && Number.isFinite(cfg.fps_max))
      ? cfg.fps_max : 60;
    return `flags: perf ${perf ? 'on' : 'off'} · lite ${lite ? 'on' : 'off'} · dprfix: ${dprfix} · fps_max: ${fpsMax}`;
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
    // Live DPR per refresh (not captured once) + guarded Chromium heap.
    const dpr = typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio)
      ? devicePixelRatio : 1;
    const heapAvail = typeof performance !== 'undefined' && performance.memory
      && typeof performance.memory.usedJSHeapSize === 'number';
    // Sample the heap at every HUD refresh (500ms) for the slope window.
    if (heapAvail) {
      this._heapSamples.push({ t: performance.now(), heap: performance.memory.usedJSHeapSize });
      if (this._heapSamples.length > HEAP_WINDOW) this._heapSamples.shift();
    }
    const mem = heapAvail
      ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB`
      : 'n/a';
    // Δheap/min: leak-shaped growth (steady +) vs GC seesaw at a plateau (≈0).
    const slope = this._heapSlope();
    const slopeTxt = slope === null ? '' : ` (${slope >= 0 ? '+' : ''}${slope.toFixed(1)}/min)`;
    this._hud.textContent =
      `build: ${CARD_VERSION}\n` +
      `dpr: ${dpr}  heap: ${mem}${slopeTxt}\n` +
      `${this._flagsLine()}\n` +
      `fps: ${this._fps}  jank: ${this._jankCount}  worst: ${Math.round(this._worstFrame)}ms\n` +
      `${beatLine}`;
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