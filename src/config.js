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
    progress_entity: '',
    respond_delay: 0,
    zoom: 85,
    transparent_bg: false,
    progress_ring_enabled: true,
    progress_vertical_fill: true,
    progress_dynamic_color: false,
    progress_invert_color: false,
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
 c.progress_dynamic_color = c.progress_dynamic_color === true;
 c.progress_invert_color = c.progress_invert_color === true;
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