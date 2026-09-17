/**
 * editor.js — Declarative visual editor schema for AxidosCard.
 *
 * Uses HA's native getConfigForm() / ha-form pipeline (the same mechanism
 * mushroom cards and the pill logger card use) so the editor renders with
 * stock Material styling: native entity pickers, sliders, toggles, and the
 * ui_action editor. No custom DOM is created here — HA renders <ha-form>
 * from the schema below.
 *
 * All defaults mirror src/config.js sanitizeConfig() clamps so the form
 * shows the same values the card actually applies at runtime.
 */

export function buildEditorForm() {
  return {
    schema: [
      // ── Entities ──
      {
        name: 'entity',
        required: true,
        selector: { entity: { filter: { domain: 'assist_satellite' } } },
      },
      {
        name: 'media_entity',
        selector: { entity: { filter: { domain: 'media_player' } } },
      },
      {
        name: 'bpm_entity',
        selector: { entity: { filter: { domain: 'sensor' } } },
      },
      // ── Row: Response Delay | Zoom Scale ──
      {
        type: 'grid',
        name: '',
        column_min_width: '200px',
        schema: [
          {
            name: 'respond_delay',
            default: 0,
            selector: {
              number: { min: 0, max: 16, step: 0.5, mode: 'slider', unit: 's' },
            },
          },
          {
            name: 'zoom',
            default: 85,
            selector: {
              number: { min: 10, max: 200, step: 1, mode: 'slider', unit: '%' },
            },
          },
        ],
      },
      // ── Appearance ──
      {
        name: 'transparent_bg',
        default: false,
        selector: { boolean: {} },
      },
      // ── Progress Ring section ──
      {
        type: 'expandable',
        name: 'progress_section',
        title: 'Progress Ring',
        flatten: true,
        schema: [
          {
            name: 'progress_entity',
            selector: { entity: { filter: { domain: 'sensor' } } },
          },
          {
            name: 'progress_ring_enabled',
            default: true,
            selector: { boolean: {} },
          },
          {
            name: 'progress_vertical_fill',
            default: true,
            selector: { boolean: {} },
          },
          {
            name: 'progress_dynamic_color',
            default: false,
            selector: { boolean: {} },
          },
          {
            name: 'progress_invert_color',
            default: false,
            selector: { boolean: {} },
          },
        ],
      },
      // ── Tap / Press section ──
      {
        type: 'expandable',
        name: 'tap_section',
        title: 'Tap / Press Configuration',
        flatten: true,
        schema: [
          {
            name: 'tap_enabled',
            default: true,
            selector: { boolean: {} },
          },
          {
            name: 'tap_action',
            selector: { ui_action: {} },
          },
          {
            type: 'grid',
            name: '',
            column_min_width: '200px',
            schema: [
              {
                name: 'tap_speed',
                default: 0.5,
                selector: {
                  number: { min: 0.1, max: 2.0, step: 0.05, mode: 'slider' },
                },
              },
              {
                name: 'tap_intensity',
                default: 1.0,
                selector: {
                  number: { min: 0.5, max: 2, step: 0.1, mode: 'slider' },
                },
              },
              {
                name: 'tap_bounces',
                default: 5,
                selector: {
                  number: { min: 1, max: 20, step: 1, mode: 'slider' },
                },
              },
              {
                name: 'tap_bop_resume',
                default: 0.3,
                selector: {
                  number: { min: 0.05, max: 0.8, step: 0.05, mode: 'slider' },
                },
              },
            ],
          },
        ],
      },
    ],
    computeLabel: (schema) => {
      // Layout nodes (grid/expandable) get no label — expandables use their
      // `title`, and a non-empty return here would double-label them.
      if (schema.type === 'grid' || schema.type === 'expandable' || !schema.name) {
        return '';
      }
      const labels = {
        entity: 'Voice Assistant Entity',
        media_entity: 'Media Player Entity',
        bpm_entity: 'BPM Sensor Entity',
        progress_entity: 'Progress Sensor Entity',
        progress_ring_enabled: 'Show Progress Ring',
        progress_vertical_fill: 'Vertical Fill (Bottom-Up)',
        progress_dynamic_color: 'Dynamic Color (Green → Red)',
        progress_invert_color: 'Invert Color Direction',
        respond_delay: 'Response Delay',
        zoom: 'Zoom Scale',
        transparent_bg: 'Transparent Background',
        tap_enabled: 'Enable Tap to Bop',
        tap_action: 'Tap Action',
        tap_speed: 'Animation Speed',
        tap_intensity: 'Bop Intensity',
        tap_bounces: 'Rebound Bounces',
        tap_bop_resume: 'Idle Resume Point',
      };
      return labels[schema.name];
    },
    computeHelper: (schema) => {
      if (schema.type === 'grid' || schema.type === 'expandable' || !schema.name) {
        return undefined;
      }
      const helpers = {
        entity: 'The assist_satellite entity AXiDOS reacts to (required).',
        media_entity: 'When this media player plays, AXiDOS dances to the BPM sensor.',
        bpm_entity: 'Sensor providing the current song BPM (e.g. SongBPM-26). Defaults to 120.',
        progress_entity: 'Sensor whose state (0-100) fills the socket ring in idle mode. Starts at the bottom, 100% lights the whole socket.',
        progress_ring_enabled: 'Show the progress ring around the socket while idle. Disable to keep the plain idle look.',
        progress_vertical_fill: 'Fills both sides of the ring from the bottom up (50% = both sides at half height). Off = the original 360° clockwise sweep from the bottom.',
        progress_dynamic_color: 'Colors the ring by position on the 0-100 scale: green at 0%, yellow mid-scale, red at 100%. Off = the idle pupil shade (amber).',
        progress_invert_color: 'Flips the dynamic color direction: red at 0%, green at 100%. Only applies when Dynamic Color is on.',
        respond_delay: 'Seconds to wait before switching from Processing to Responding.',
        zoom: 'Scale percentage of the SVG model inside the card. Above 100 the card grows to keep the model fully visible.',
        transparent_bg: 'Removes the card background, shadow, and border.',
        tap_enabled: 'Plays the bop animation when the card is tapped.',
        tap_action: 'Optional Home Assistant action fired on tap.',
        tap_speed: '0.1 = slow, 0.5 = normal, 2.0 = fast.',
        tap_intensity: 'How far the head pulls back.',
        tap_bounces: 'Full oscillation cycles before settling.',
        tap_bop_resume: 'Point in the bop tail (fraction of max bounce) where the paused background resumes: idle head poses, or the dance choreography if AXiDOS was dancing. Low = resume late, high = resume early.',
      };
      return helpers[schema.name];
    },
  };
}