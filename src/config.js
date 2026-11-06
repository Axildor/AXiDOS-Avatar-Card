/**
 * config.js — Pure config sanitization and defaults.
 * No DOM access. Safe to unit-test in isolation.
 */

export function clampNum(val, def, min, max) {
  const n = Number(val !== undefined && val !== null && val !== '' ? val : def);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function getStubConfig() {
  return {
    entity: '',
    media_entity: '',
    bpm_entity: '',
    mood_entity: '',
    progress_entity: '',
    respond_delay: 0,
    zoom: 85,
    transparent_bg: false,
    progress_ring_enabled: true,
    progress_vertical_fill: true,
    progress_show_in_dance: true,
    progress_min: 0,
    progress_max: 100,
    progress_dynamic_color: false,
    progress_invert_color: false,
    mood_style_enabled: true,
    // 5.8.0 motion policy. 'full' keeps every channel (the 5.7.x behaviour);
    // 'reduced' REMOVES work (no glitch, no optic strobe, no conduit motion);
    // 'off' composes one static frame per state and schedules nothing.
    motion_intensity: 'full',
    // 5.8.0 flash safety, default ON: keeps the red/white optic strobe and the
    // danger-ring pulse at or below 2 Hz at every tempo. Set false to restore
    // the legacy every-beat toggle.
    flash_safe: true,
    debug_perf: false,
    debug_lite: false,
    debug_dprfix: false,
    fps_max: 60,
    tap_enabled: true,
    tap_speed: 0.5,
    tap_bounces: 5,
    tap_intensity: 1.0,
    tap_bop_resume: 0.3,
    tap_action: { action: 'none' },
  };
}

/**
 * Deep clone, validate, and clamp a user config so downstream code
 * (template, animator, behaviors, editor) always reads clean values.
 */
export function sanitizeConfig(config) {
  // Deep clone to prevent HA immutable state violations
  const c = JSON.parse(JSON.stringify(config));

  if (!c.entity) {
    throw new Error('You need to define an entity');
  }

  c.zoom = clampNum(c.zoom, 85, 10, 200);
  c.respond_delay = clampNum(c.respond_delay, 0, 0, 16);
  c.progress_entity = typeof c.progress_entity === 'string' ? c.progress_entity : '';
 c.progress_ring_enabled = c.progress_ring_enabled !== false;
 c.progress_vertical_fill = c.progress_vertical_fill !== false;
 c.progress_show_in_dance = c.progress_show_in_dance !== false;
 c.progress_dynamic_color = c.progress_dynamic_color === true;
 c.progress_invert_color = c.progress_invert_color === true;
  // Progress bounds: map the sensor's raw range onto the 0-100 ring scale.
  // Defaults keep the legacy 0-100 percentage behavior. If the user gives an
  // inverted or empty range (min >= max), fall back to the defaults rather
  // than producing a divide-by-zero / always-0% ring.
  c.progress_min = clampNum(c.progress_min, 0, -1e9, 1e9);
  c.progress_max = clampNum(c.progress_max, 100, -1e9, 1e9);
  if (c.progress_min >= c.progress_max) {
    c.progress_min = 0;
    c.progress_max = 100;
  }
  // Mood-aware dance style (5.6.0): reads the mood from the dedicated AX BPM
  // mood entity (3.3.0+ — state = mood label, attributes = mood_scores) and
  // shifts the phrase-library tier + energy envelope. Default ON; `!== false`
  // keeps legacy configs (which lack the key) enabled.
  c.mood_style_enabled = c.mood_style_enabled !== false;
  // Mood entity (5.7.0): the AX BPM integration's dedicated mood sensor.
  // Required for mood steering — without it the dance stays on the plain
  // BPM-derived style (the BPM sensor no longer carries mood attributes).
  // Empty stays empty here on purpose: hass-update.js:resolveMoodEntity()
  // opportunistically adopts 'sensor.ax_bpm_mood' at delivery time when it
  // exists, because whether that entity exists is hass state, not config.
  c.mood_entity = typeof c.mood_entity === 'string' ? c.mood_entity : '';
  // Motion policy (5.8.0). Unknown values fall back to 'full', so an older
  // config (or a typo) can never accidentally freeze the card. The OS
  // prefers-reduced-motion preference is applied on top of this at delivery
  // time (axidos-card.js owns the matchMedia listener), never here — a config
  // file cannot observe a device preference.
  c.motion_intensity = (c.motion_intensity === 'reduced' || c.motion_intensity === 'off')
    ? c.motion_intensity : 'full';
  // Flash safety (5.8.0): DEFAULT ON. `!== false` keeps every pre-5.8.0
  // config (which lacks the key) on the safe path, which is the correct
  // direction for a photosensitivity control — an opt-in would leave existing
  // users exposed to the 2.8 Hz strobe they never agreed to.
  c.flash_safe = c.flash_safe !== false;
  // Perf diagnostics (5.8.0): opt-in on-card performance HUD (FPS, jank
  // frames, beat-timer lateness) for devices without console access
  // (Android WebView / View Assist Companion App). Default OFF — zero cost
  // when disabled (no RAF sampler, no HUD element).
  c.debug_perf = c.debug_perf === true;
  // Lite mode (5.7.0-beta.1): freezes the always-on ambient motion (body
  // sway + head ambient sway CSS keyframes) to isolate the baseline repaint
  // load in the tablet A/B protocol. Default OFF — zero behavior change.
  c.debug_lite = c.debug_lite === true;
  // DPR compositing workaround (5.7.0-beta.1): crbug 449095626 — SVG
  // transform animations are not composited when device scale factor > 1
  // (they animate on the main thread). The workaround rescales #axidos-svg
  // so the compositor path re-engages. Default OFF — zero behavior change;
  // a visual no-op at DSF == 1 by construction (dprFixStyles returns null).
  c.debug_dprfix = c.debug_dprfix === true;
  // JS motion frame cap (5.7.0-beta.3): the card's JS motion loops (bop
  // spring, idle glitch) tick at display rate — 4x per-second work for zero
  // perceptual gain on a 240 Hz desktop at this card's slow, small-angle
  // motion amplitude. requestRaf gates callbacks to this rate (springs are
  // dt-based integrators — visuals stay pixel-identical, only tick COUNT
  // drops). Default 60 (the panel rate of the target device); accepted
  // values clamp to 30–240.
  c.fps_max = clampNum(c.fps_max, 60, 30, 240);
  c.tap_speed = clampNum(c.tap_speed, 0.5, 0.1, 2.0);
  c.tap_intensity = clampNum(c.tap_intensity, 1.0, 0.5, 2);
  c.tap_bounces = Math.round(clampNum(c.tap_bounces, 5, 1, 20));
  // Fraction of max bounce amplitude at which idle/dance head poses resume
  // during the bop tail (the "meld" point). 0.05 = resume very late,
  // 0.8 = resume almost immediately.
  c.tap_bop_resume = clampNum(c.tap_bop_resume, 0.3, 0.05, 0.8);

  // Normalize legacy string tap_action to standard HA object schema
  if (typeof c.tap_action === 'string') {
    c.tap_action = { action: c.tap_action };
  } else if (!c.tap_action) {
    c.tap_action = { action: 'none' };
  }

  return c;
}