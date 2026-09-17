// src/config.js
function clampNum(val, def, min, max) {
  const n = Number(val !== void 0 && val !== null && val !== "" ? val : def);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function getStubConfig() {
  return {
    entity: "",
    media_entity: "",
    bpm_entity: "",
    progress_entity: "",
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
    tap_intensity: 1,
    tap_bop_resume: 0.3,
    tap_action: { action: "none" }
  };
}
function sanitizeConfig(config) {
  const c = JSON.parse(JSON.stringify(config));
  if (!c.entity) {
    throw new Error("You need to define an entity");
  }
  c.zoom = clampNum(c.zoom, 85, 10, 200);
  c.respond_delay = clampNum(c.respond_delay, 0, 0, 16);
  c.progress_entity = typeof c.progress_entity === "string" ? c.progress_entity : "";
  c.progress_ring_enabled = c.progress_ring_enabled !== false;
  c.progress_vertical_fill = c.progress_vertical_fill !== false;
  c.progress_dynamic_color = c.progress_dynamic_color === true;
  c.progress_invert_color = c.progress_invert_color === true;
  c.tap_speed = clampNum(c.tap_speed, 0.5, 0.1, 2);
  c.tap_intensity = clampNum(c.tap_intensity, 1, 0.5, 2);
  c.tap_bounces = Math.round(clampNum(c.tap_bounces, 5, 1, 20));
  c.tap_bop_resume = clampNum(c.tap_bop_resume, 0.3, 0.05, 0.8);
  if (typeof c.tap_action === "string") {
    c.tap_action = { action: c.tap_action };
  } else if (!c.tap_action) {
    c.tap_action = { action: "none" };
  }
  return c;
}

// src/editor.js
function buildEditorForm() {
  return {
    schema: [
      // ── Entities ──
      {
        name: "entity",
        required: true,
        selector: { entity: { filter: { domain: "assist_satellite" } } }
      },
      {
        name: "media_entity",
        selector: { entity: { filter: { domain: "media_player" } } }
      },
      {
        name: "bpm_entity",
        selector: { entity: { filter: { domain: "sensor" } } }
      },
      // ── Row: Response Delay | Zoom Scale ──
      {
        type: "grid",
        name: "",
        column_min_width: "200px",
        schema: [
          {
            name: "respond_delay",
            default: 0,
            selector: {
              number: { min: 0, max: 16, step: 0.5, mode: "slider", unit: "s" }
            }
          },
          {
            name: "zoom",
            default: 85,
            selector: {
              number: { min: 10, max: 200, step: 1, mode: "slider", unit: "%" }
            }
          }
        ]
      },
      // ── Appearance ──
      {
        name: "transparent_bg",
        default: false,
        selector: { boolean: {} }
      },
      // ── Progress Ring section ──
      {
        type: "expandable",
        name: "progress_section",
        title: "Progress Ring",
        flatten: true,
        schema: [
          {
            name: "progress_entity",
            selector: { entity: { filter: { domain: "sensor" } } }
          },
          {
            name: "progress_ring_enabled",
            default: true,
            selector: { boolean: {} }
          },
          {
            name: "progress_vertical_fill",
            default: true,
            selector: { boolean: {} }
          },
          {
            name: "progress_dynamic_color",
            default: false,
            selector: { boolean: {} }
          },
          {
            name: "progress_invert_color",
            default: false,
            selector: { boolean: {} }
          }
        ]
      },
      // ── Tap / Press section ──
      {
        type: "expandable",
        name: "tap_section",
        title: "Tap / Press Configuration",
        flatten: true,
        schema: [
          {
            name: "tap_enabled",
            default: true,
            selector: { boolean: {} }
          },
          {
            name: "tap_action",
            selector: { ui_action: {} }
          },
          {
            type: "grid",
            name: "",
            column_min_width: "200px",
            schema: [
              {
                name: "tap_speed",
                default: 0.5,
                selector: {
                  number: { min: 0.1, max: 2, step: 0.05, mode: "slider" }
                }
              },
              {
                name: "tap_intensity",
                default: 1,
                selector: {
                  number: { min: 0.5, max: 2, step: 0.1, mode: "slider" }
                }
              },
              {
                name: "tap_bounces",
                default: 5,
                selector: {
                  number: { min: 1, max: 20, step: 1, mode: "slider" }
                }
              },
              {
                name: "tap_bop_resume",
                default: 0.3,
                selector: {
                  number: { min: 0.05, max: 0.8, step: 0.05, mode: "slider" }
                }
              }
            ]
          }
        ]
      }
    ],
    computeLabel: (schema) => {
      if (schema.type === "grid" || schema.type === "expandable" || !schema.name) {
        return "";
      }
      const labels = {
        entity: "Voice Assistant Entity",
        media_entity: "Media Player Entity",
        bpm_entity: "BPM Sensor Entity",
        progress_entity: "Progress Sensor Entity",
        progress_ring_enabled: "Show Progress Ring",
        progress_vertical_fill: "Vertical Fill (Bottom-Up)",
        progress_dynamic_color: "Dynamic Color (Green \u2192 Red)",
        progress_invert_color: "Invert Color Direction",
        respond_delay: "Response Delay",
        zoom: "Zoom Scale",
        transparent_bg: "Transparent Background",
        tap_enabled: "Enable Tap to Bop",
        tap_action: "Tap Action",
        tap_speed: "Animation Speed",
        tap_intensity: "Bop Intensity",
        tap_bounces: "Rebound Bounces",
        tap_bop_resume: "Idle Resume Point"
      };
      return labels[schema.name];
    },
    computeHelper: (schema) => {
      if (schema.type === "grid" || schema.type === "expandable" || !schema.name) {
        return void 0;
      }
      const helpers = {
        entity: "The assist_satellite entity AXiDOS reacts to (required).",
        media_entity: "When this media player plays, AXiDOS dances to the BPM sensor.",
        bpm_entity: "Sensor providing the current song BPM (e.g. SongBPM-26). Defaults to 120.",
        progress_entity: "Sensor whose state (0-100) fills the socket ring in idle mode. Starts at the bottom, 100% lights the whole socket.",
        progress_ring_enabled: "Show the progress ring around the socket while idle. Disable to keep the plain idle look.",
        progress_vertical_fill: "Fills both sides of the ring from the bottom up (50% = both sides at half height). Off = the original 360\xB0 clockwise sweep from the bottom.",
        progress_dynamic_color: "Colors the ring by position on the 0-100 scale: green at 0%, yellow mid-scale, red at 100%. Off = the idle pupil shade (amber).",
        progress_invert_color: "Flips the dynamic color direction: red at 0%, green at 100%. Only applies when Dynamic Color is on.",
        respond_delay: "Seconds to wait before switching from Processing to Responding.",
        zoom: "Scale percentage of the SVG model inside the card. Above 100 the card grows to keep the model fully visible.",
        transparent_bg: "Removes the card background, shadow, and border.",
        tap_enabled: "Plays the bop animation when the card is tapped.",
        tap_action: "Optional Home Assistant action fired on tap.",
        tap_speed: "0.1 = slow, 0.5 = normal, 2.0 = fast.",
        tap_intensity: "How far the head pulls back.",
        tap_bounces: "Full oscillation cycles before settling.",
        tap_bop_resume: "Point in the bop tail (fraction of max bounce) where the paused background resumes: idle head poses, or the dance choreography if AXiDOS was dancing. Low = resume late, high = resume early."
      };
      return helpers[schema.name];
    }
  };
}

// src/state-mapper.js
function mapVoiceState(raw) {
  const s = (raw || "idle").toLowerCase();
  if (s.includes("respond") || s.includes("speak") || s.includes("tts")) return "responding";
  if (s.includes("listen") || s.includes("wake")) return "listening";
  if (s.includes("process") || s.includes("think")) return "processing";
  if (s === "dancing") return "dancing";
  return "idle";
}
function resolveState(voiceState, mediaState) {
  let mapped = mapVoiceState(voiceState);
  if (mapped === "idle" && mediaState === "playing") mapped = "dancing";
  return mapped;
}
function parseBpm(rawBpm) {
  const n = parseFloat(rawBpm);
  return isNaN(n) ? 120 : n;
}
function parseProgress(raw) {
  if (raw === void 0 || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "" || s === "unavailable" || s === "unknown" || s === "none") return null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}
function progressColor(pct, dynamic, inverted) {
  if (!dynamic) return "#ffcc00";
  const t = Math.min(100, Math.max(0, pct)) / 100;
  const hue = inverted ? t * 120 : 120 - t * 120;
  return `hsl(${hue.toFixed(1)}, 100%, 45%)`;
}
function verticalProgressDash(pct) {
  const R = 33;
  const SIDE = 95.5;
  const H = 161.5;
  const CAP = Math.PI / 2 * R;
  const PERIM = 4 * CAP + 2 * SIDE;
  const t = Math.min(100, Math.max(0, pct)) / 100;
  if (t <= 0) return "0 100";
  const d = t * H;
  let lit;
  if (d <= R) {
    lit = R * Math.acos(1 - d / R);
  } else if (d <= R + SIDE) {
    lit = CAP + (d - R);
  } else {
    lit = CAP + SIDE + R * Math.asin((d - R - SIDE) / R);
  }
  const L = lit / PERIM * 100;
  const G = 50 - L;
  return `${L.toFixed(2)} ${G.toFixed(2)} ${L.toFixed(2)} ${G.toFixed(2)}`;
}

// src/template.js
function buildTemplate(config) {
  const zoom = config.zoom !== void 0 ? config.zoom : 85;
  const scale = zoom / 100;
  const width = 280 * scale;
  const height = 320 * scale;
  const bgStyle = config.transparent_bg ? "background: transparent; box-shadow: none; border: none;" : "background: var(--ha-card-background, var(--card-background-color, #1c1c1c));";
  return `
    <style>
      :host { display: flex; align-items: center; justify-content: center; ${bgStyle} border-radius: var(--ha-card-border-radius, 12px); overflow: hidden; width: 100%; }
      /* contain: layout paint \u2014 repaints inside the card never invalidate the
         dashboard around it (and vice versa) on weak tablet GPUs. */
      /* flex: none \u2014 the scene keeps its exact zoomed px size; a flex item
         would otherwise shrink back to the slot width at zoom > 100, and the
         SVG's preserveAspectRatio would pin the model at ~100%. getGridOptions()
         grows the slot (rows AND columns) to match. */
      #scene { position: relative; flex: none; width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center; contain: layout paint; }

      #hitbox { position: absolute; inset: 0; z-index: 100; cursor: pointer; display: none; }
      /* isolation: isolate \u2014 the SVG forms its own stacking context so its
         compositor layers don't interleave with the rest of the dashboard. */
      #axidos-svg { width: 100%; height: 100%; display: block; overflow: visible; pointer-events: none; isolation: isolate; --led-color: #ffb800; --led-opacity: 0.15; }

      /* ---- Compositor-layer promotion ----
         Every group animated via transform gets will-change: transform so the
         browser hoists it to its own GPU layer: per-frame transform writes
         (RAF spring loop, CSS transitions) then composite on the GPU instead
         of triggering main-thread SVG repaints. Applied ONLY to groups that
         actually animate \u2014 each hint costs GPU memory. Includes the ambient
         sway pivots (#body-pivot, #head-sway-pivot): their infinite CSS
         keyframe rotations repaint the whole subtree every frame unless
         promoted. */
      #axidos-head, #head-bop, #torso-swivel, #bellows,
      #eyeball-assembly, #eye-pupil, #eye-lid, #eye-lid-bottom, #eye-center,
      #body-pivot, #head-sway-pivot {
        will-change: transform;
      }
      /* Rotation/scale groups need view-box coordinates for transform-origin. */
      #axidos-head, #head-bop, #torso-swivel, #eye-center,
      #body-pivot, #head-sway-pivot { transform-box: view-box; }
      /* Bop layer: dedicated transform group for the tap-bop spring so it
         composes additively with the head poses (#axidos-head) instead of
         fighting over one transform. Pivots at the neck like #axidos-head. */
      #head-bop { transform-origin: 140px 285px; }

      .led-dot, #ind-l1, #ind-l2, #ind-r1, #ind-r2 { transition: opacity 0.15s ease-out; fill: var(--led-color); opacity: var(--led-opacity); }
      .led-matrix.pulsing .led-dot { animation: led-pulse 0.9s ease-in-out infinite; }
      @keyframes led-pulse { 0%,100% { opacity: var(--led-opacity); } 50% { opacity: calc(var(--led-opacity) * 0.3); } }

      #body-pivot { transform-origin: 140px 116px; animation: body-sway 8s ease-in-out infinite; }
      @keyframes body-sway { 0%, 100% { transform: rotate(-1.4deg); } 50% { transform: rotate( 1.4deg); } }

      #head-sway-pivot { transform-origin: 140px 285px; animation: head-ambient-sway 13s ease-in-out infinite; }
      @keyframes head-ambient-sway { 0%, 100% { transform: rotate(-0.8deg); } 50% { transform: rotate(0.8deg); } }

      #torso-swivel { transform-origin: 140px 116px; transition: transform 2.0s cubic-bezier(0.45,0.05,0.55,0.95); }
      #axidos-head { transform-box: view-box; transform-origin: 140px 285px; transition: transform 1.6s cubic-bezier(0.34, 1.06, 0.64, 1); }

      #eye-halo { transition: fill 0.8s ease-in-out; }
      /* Eye pulse: the dance engine scales #eye-center every beat; a short
         transform transition turns that write into an organic pulse instead
         of a snap. Kept short so the pulse still lands on the beat. */
      #eye-center { transition: fill 0.8s ease-in-out, transform 0.18s ease-out; }
      .eye-layer { transition: opacity 0.8s ease-in-out; }
      @keyframes eye-breathe { 0%,100%{opacity:.02} 48%{opacity:.2} }
      #eye-halo.breathing { animation: eye-breathe 8s ease-in-out infinite; }
      @keyframes danger-flash { 0%,100%{opacity:0} 50%{opacity:1} }
      #danger-ring.active { animation: danger-flash .35s ease-in-out infinite; }

      /* Idle progress ring: dasharray-driven fill (pathLength=100 \u2192 the dash
         length IS the percentage). Smooth transitions turn sensor jumps into
         a glide; opacity gates visibility to the idle state. */
      #progress-ring {
        transition: stroke-dasharray 0.6s ease-in-out, stroke 0.6s ease-in-out, opacity 0.8s ease-in-out;
      }
    </style>
    <div id="scene">
      <div id="hitbox" role="button" tabindex="0" aria-label="AXiDOS tap action"></div>
      <svg id="axidos-svg" viewBox="0 116 280 320" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
          <linearGradient id="ceramicGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#8a8d94"/><stop offset="8%" stop-color="#b0b4bc"/><stop offset="8.5%" stop-color="#ffffff"/><stop offset="25%" stop-color="#ffffff"/><stop offset="75%" stop-color="#ffffff"/><stop offset="91.5%" stop-color="#e8eaec"/><stop offset="92%" stop-color="#a0a4ac"/><stop offset="100%" stop-color="#6a6d75"/></linearGradient>
          <linearGradient id="ceramicBackgroundGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#4a4d54"/><stop offset="8%" stop-color="#70747c"/><stop offset="8.5%" stop-color="#b0b4bc"/><stop offset="25%" stop-color="#b0b4bc"/><stop offset="75%" stop-color="#b0b4bc"/><stop offset="91.5%" stop-color="#a0a4ac"/><stop offset="92%" stop-color="#6a6d75"/><stop offset="100%" stop-color="#3a3d44"/></linearGradient>
          <linearGradient id="ceramicShadow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="0"/><stop offset="60%" stop-color="#60646c" stop-opacity="0.1"/><stop offset="85%" stop-color="#2a2c32" stop-opacity="0.5"/><stop offset="100%" stop-color="#0a0a0f" stop-opacity="0.85"/></linearGradient>
          <linearGradient id="bezelGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#4a4d54"/><stop offset="20%" stop-color="#6a6d75"/><stop offset="50%" stop-color="#3a3c42"/><stop offset="80%" stop-color="#1a1c20"/><stop offset="100%" stop-color="#0a0a0c"/></linearGradient>
          <linearGradient id="cavityGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#181a1c"/><stop offset="100%" stop-color="#30353a"/></linearGradient>
          <linearGradient id="trackGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#1a1c20"/><stop offset="50%" stop-color="#3a3e46"/><stop offset="100%" stop-color="#121316"/></linearGradient>
          <radialGradient id="eyeGradIdle" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="20%" stop-color="#ffcc00"/><stop offset="55%" stop-color="#d95500"/><stop offset="80%" stop-color="#7a1100"/><stop offset="100%" stop-color="#110000"/></radialGradient>
          <radialGradient id="eyeGradListen" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="25%" stop-color="#aaffff"/><stop offset="60%" stop-color="#00ccff"/><stop offset="85%" stop-color="#0066aa"/><stop offset="100%" stop-color="#001a33"/></radialGradient>
          <radialGradient id="eyeGradProcess" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="25%" stop-color="#ffddaa"/><stop offset="60%" stop-color="#ff6600"/><stop offset="85%" stop-color="#aa3300"/><stop offset="100%" stop-color="#220a00"/></radialGradient>
          <radialGradient id="eyeGradRespond" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="25%" stop-color="#ffaaaa"/><stop offset="60%" stop-color="#ff2200"/><stop offset="85%" stop-color="#aa0000"/><stop offset="100%" stop-color="#220000"/></radialGradient>
          <radialGradient id="eyeGradDance" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="20%" stop-color="#aaffaa"/><stop offset="55%" stop-color="#1DB954"/><stop offset="80%" stop-color="#0a5926"/><stop offset="100%" stop-color="#001a00"/></radialGradient>
          <!-- No SVG filters remain: feGaussianBlur re-rasterizes on every
               transform write and defeats compositor-layer promotion on
               Android WebView. The faceplate inset's soft fringe is faked
               with stepped rects (see Group_Faceplate_Inset); the eye glow
               uses the pre-blurred radial gradient below. -->
          <!-- Fake glow: pre-blurred radial gradient, rasterized once and
               cached as a texture. Used on the eye layers + indicator dot. -->
          <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
            <stop offset="45%" stop-color="#ffffff" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="haloGradIdle"><stop offset="0%" stop-color="#330800" stop-opacity="1"/><stop offset="60%" stop-color="#330800" stop-opacity="0.4"/><stop offset="100%" stop-color="#330800" stop-opacity="0"/></radialGradient>
          <radialGradient id="haloGradDance"><stop offset="0%" stop-color="#1DB954" stop-opacity="1"/><stop offset="60%" stop-color="#1DB954" stop-opacity="0.4"/><stop offset="100%" stop-color="#1DB954" stop-opacity="0"/></radialGradient>
          <radialGradient id="haloGradListen"><stop offset="0%" stop-color="#00ccff" stop-opacity="1"/><stop offset="60%" stop-color="#00ccff" stop-opacity="0.4"/><stop offset="100%" stop-color="#00ccff" stop-opacity="0"/></radialGradient>
          <radialGradient id="haloGradProcess"><stop offset="0%" stop-color="#ff6600" stop-opacity="1"/><stop offset="60%" stop-color="#ff6600" stop-opacity="0.4"/><stop offset="100%" stop-color="#ff6600" stop-opacity="0"/></radialGradient>
          <radialGradient id="haloGradRespond"><stop offset="0%" stop-color="#ff2200" stop-opacity="1"/><stop offset="60%" stop-color="#ff2200" stop-opacity="0.4"/><stop offset="100%" stop-color="#ff2200" stop-opacity="0"/></radialGradient>
          <linearGradient id="lidGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1f2124"/><stop offset="100%" stop-color="#08090a"/></linearGradient>
          <linearGradient id="lidGradFlip" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#1f2124"/><stop offset="100%" stop-color="#08090a"/></linearGradient>
          <clipPath id="cavityClip"><rect x="97" y="283.25" width="66" height="161.5" rx="33"/></clipPath>
          <clipPath id="trackClip"><rect x="107" y="293.25" width="46" height="141.5" rx="23"/></clipPath>
          <clipPath id="eyeballClip"><circle cx="130" cy="364" r="25.5"/></clipPath>
          <!-- socketClip: hard geometric bound for the pupil. The iris
               (r=17.6) sits inside the socket face (r=23), leaving only a
               5.4 px translation budget \u2014 dance darts can request more.
               Applied to a STATIC wrapper group (not #eye-pupil itself) so
               the clip does not translate with the pupil it clips. -->
          <clipPath id="socketClip"><circle cx="130" cy="364" r="23"/></clipPath>
        </defs>
        <g id="body-pivot">
          <g id="torso-swivel">
            <g id="torso" transform="matrix(1.2,0,0,1.2,-28,-23.2)">
              <ellipse cx="140" cy="116" rx="55" ry="15" fill="#1c1c26" stroke="#0c0c12" stroke-width="1.2"/>
              <ellipse cx="140" cy="116" rx="46" ry="11" fill="#141420" stroke="#1e1e2c" stroke-width="0.7"/>
              <path d="m 94,126 -8,8 -2,66 q 0,10 10,12 h 92 q 10,-2 10,-12 l -2,-66 -8,-8 z" fill="url(#ceramicBackgroundGrad)" stroke="#6a6d75" stroke-width="1.4"/>
              <path d="m 90,132 -28,8 -4,40 4,16 12,4 16,-4 z" fill="url(#ceramicBackgroundGrad)" stroke="#6a6d75" stroke-width="1"/>
              <path d="m 90,136 -24,7 -4,35 4,14 10,4 14,-4 z" fill="#eeeeee" opacity="0.05"/>
              <circle cx="60" cy="168" r="9" fill="#14141c" stroke="#0c0c12" stroke-width="1"/>
              <circle cx="60" cy="168" r="5.5" fill="#0c0c10" stroke="#1a1a22" stroke-width="0.8"/>
              <path d="m 90,132 c -4,20 -6,40 -4,60" stroke="#1a1a22" stroke-width="2.5" fill="none" opacity="0.8"/>
              <path d="m 190,132 28,8 4,40 -4,16 -12,4 -16,-4 z" fill="url(#ceramicBackgroundGrad)" stroke="#6a6d75" stroke-width="1"/>
              <path d="m 190,136 24,7 4,35 -4,14 10,4 14,-4 z" fill="#eeeeee" opacity="0.05"/>
              <circle cx="220" cy="168" r="9" fill="#14141c" stroke="#0c0c12" stroke-width="1"/>
              <circle cx="220" cy="168" r="5.5" fill="#0c0c10" stroke="#1a1a22" stroke-width="0.8"/>
              <path d="m 190,132 c 4,20 6,40 4,60" stroke="#1a1a22" stroke-width="2.5" fill="none" opacity="0.8"/>
              <line x1="90" y1="152" x2="190" y2="152" stroke="#6a6d75" stroke-width="1"/>
              <line x1="89" y1="174" x2="191" y2="174" stroke="#6a6d75" stroke-width="1"/>
              <line x1="140" y1="128" x2="140" y2="210" stroke="#6a6d75" stroke-width="1"/>
              <rect x="94" y="135" width="36" height="20" rx="2.5" fill="#050508" stroke="#101014" stroke-width="0.6"/>
              <rect x="96" y="137" width="32" height="16" rx="1.5" fill="#020202"/>
              <g id="led-matrix-left" class="led-matrix">
                <rect class="led-dot" x="98" y="140" width="28" height="2" rx="1"/>
                <rect class="led-dot" x="98" y="145" width="28" height="2" rx="1"/>
                <rect class="led-dot" x="98" y="150" width="28" height="2" rx="1"/>
              </g>
              <rect x="150" y="135" width="36" height="20" rx="2.5" fill="#050508" stroke="#101014" stroke-width="0.6"/>
              <rect x="152" y="137" width="32" height="16" rx="1.5" fill="#020202"/>
              <g id="led-matrix-right" class="led-matrix">
                <rect class="led-dot" x="154" y="140" width="28" height="2" rx="1"/>
                <rect class="led-dot" x="154" y="145" width="28" height="2" rx="1"/>
                <rect class="led-dot" x="154" y="150" width="28" height="2" rx="1"/>
              </g>
              <circle cx="100" cy="180" r="2.5" fill="#0a0a0e" stroke="#101014" stroke-width="0.5"/>
              <circle id="ind-l1" cx="100" cy="180" r="1.5"/>
              <circle cx="108" cy="180" r="2.5" fill="#0a0a0e" stroke="#101014" stroke-width="0.5"/>
              <circle id="ind-l2" cx="108" cy="180" r="1.5"/>
              <circle cx="172" cy="180" r="2.5" fill="#0a0a0e" stroke="#101014" stroke-width="0.5"/>
              <circle id="ind-r1" cx="172" cy="180" r="1.5"/>
              <circle cx="180" cy="180" r="2.5" fill="#0a0a0e" stroke="#101014" stroke-width="0.5"/>
              <circle id="ind-r2" cx="180" cy="180" r="1.5"/>
            </g>
          </g>
        </g>
        <g id="axidos-head-wrapper" transform="translate(0, -65)">
          <g id="head-sway-pivot">
            <g id="axidos-head">
              <g id="head-bop">
              <ellipse cx="140" cy="285" rx="18" ry="6" fill="#181824" stroke="#0a0a0f" stroke-width="1"/>
              <ellipse cx="140" cy="285" rx="12" ry="3.8" fill="#101015" stroke="#181824" stroke-width="0.6"/>
              <g id="Group_White_Casing">
                <path id="rect74" fill="url(#ceramicGrad)" d="m 135,232 h 10 c 20.41692,0 38.38909,10.09589 49.21698,25.58812 L 205,276.8 c 0,0 2.4,52.45447 2.4,78.7 0,26.24553 -2.4,78.7 -2.4,78.7 l -10.77334,19.19803 C 183.3998,468.8981 165.423,479 145,479 H 135 C 114.59769,479 96.636634,468.91856 85.806278,453.44514 L 75,434.2 c 0,0 -2.4,-52.45447 -2.4,-78.7 0,-26.24553 2.4,-78.7 2.4,-78.7 L 85.808333,257.55193 C 96.638906,242.08017 114.59898,232 135,232 Z"/>
                <rect x="75" y="232" width="130" height="247" rx="60" fill="url(#ceramicShadow)"/>
              </g>
              <g id="Group_Faceplate_Inset">
                <!-- Stepped fake of the old 2px blur filter: two expanded
                     black rects beneath the base rect approximate the blur's
                     soft dark fringe without an SVG filter (zero re-raster
                     cost). Static \u2014 rasterized once. -->
                <rect x="91" y="277.25" width="80" height="175.5" rx="40" fill="#000" opacity="0.12"/>
                <rect x="92" y="278.25" width="78" height="173.5" rx="39" fill="#000" opacity="0.30"/>
                <rect x="93" y="279.25" width="76" height="171.5" rx="38" fill="#000" opacity="0.6"/>
                <rect x="91" y="277.25" width="78" height="173.5" rx="39" fill="url(#bezelGrad)" stroke="#1a1c22" stroke-width="1"/>
                <rect x="93" y="279.25" width="74" height="169.5" rx="37" fill="none" stroke="#6a6d75" stroke-width="1.5"/>
                <g clip-path="url(#cavityClip)">
                  <rect x="97" y="283.25" width="66" height="161.5" rx="33" fill="url(#cavityGrad)"/>
                  <rect x="97" y="283.25" width="66" height="161.5" rx="33" fill="none" stroke="#050607" stroke-width="5" opacity="0.9"/>
                  <rect x="107" y="293.25" width="46" height="141.5" rx="23" fill="url(#trackGrad)" stroke="#000000" stroke-width="3"/>
                  <g clip-path="url(#trackClip)">
                    <g id="bellows" style="transition: transform 0.15s ease-out;">
                      <g stroke="#000" stroke-width="4.5" stroke-linecap="butt" opacity="0.9">
                        <line x1="107" y1="140" x2="153" y2="140"/><line x1="107" y1="152" x2="153" y2="152"/><line x1="107" y1="164" x2="153" y2="164"/><line x1="107" y1="176" x2="153" y2="176"/><line x1="107" y1="188" x2="153" y2="188"/><line x1="107" y1="200" x2="153" y2="200"/><line x1="107" y1="212" x2="153" y2="212"/><line x1="107" y1="224" x2="153" y2="224"/><line x1="107" y1="236" x2="153" y2="236"/><line x1="107" y1="248" x2="153" y2="248"/><line x1="107" y1="260" x2="153" y2="260"/><line x1="107" y1="272" x2="153" y2="272"/><line x1="107" y1="284" x2="153" y2="284"/><line x1="107" y1="296" x2="153" y2="296"/><line x1="107" y1="308" x2="153" y2="308"/><line x1="107" y1="320" x2="153" y2="320"/><line x1="107" y1="332" x2="153" y2="332"/><line x1="107" y1="344" x2="153" y2="344"/><line x1="107" y1="356" x2="153" y2="356"/><line x1="107" y1="368" x2="153" y2="368"/><line x1="107" y1="380" x2="153" y2="380"/><line x1="107" y1="392" x2="153" y2="392"/><line x1="107" y1="404" x2="153" y2="404"/><line x1="107" y1="416" x2="153" y2="416"/><line x1="107" y1="428" x2="153" y2="428"/><line x1="107" y1="440" x2="153" y2="440"/><line x1="107" y1="452" x2="153" y2="452"/><line x1="107" y1="464" x2="153" y2="464"/><line x1="107" y1="476" x2="153" y2="476"/><line x1="107" y1="488" x2="153" y2="488"/><line x1="107" y1="500" x2="153" y2="500"/><line x1="107" y1="512" x2="153" y2="512"/><line x1="107" y1="524" x2="153" y2="524"/>
                      </g>
                    </g>
                  </g>
                  <g id="eyeball-assembly" style="transition: transform 0.15s ease-out;">
                    <circle cx="130" cy="364" r="26" fill="#1c1e22" stroke="#000000" stroke-width="2"/>
                    <circle cx="130" cy="364" r="23" fill="#0a0b0c"/>
                    <circle cx="147" cy="388" r="3.5" fill="#1a0000" stroke="#000000" stroke-width="1"/>
                    <circle id="indicator-dot" cx="147" cy="388" r="2.5" fill="#ff2200" opacity="0.8"/>
                    <circle id="eye-halo" cx="130" cy="364" r="25" fill="url(#haloGradIdle)" opacity=".05"/>
                    <!-- Static clip wrapper: socketClip must live on a PARENT
                         of #eye-pupil \u2014 a clip on the pupil itself would
                         translate along with it and clip nothing. -->
                    <g clip-path="url(#socketClip)">
                      <g id="eye-pupil" style="transition: transform 0.15s ease-out;">
                      <!-- Pre-blurred glow halo (rasterized once) replaces the
                           per-frame feGaussianBlur that used to sit on each
                           eye layer \u2014 visually equivalent soft edge, zero
                           filter cost while the pupil moves. -->
                      <circle id="eye-glow" cx="130" cy="364" r="21" fill="url(#glowGrad)" opacity="0.55" pointer-events="none"/>
                      <circle id="eye-layer-idle" cx="130" cy="364" r="17.6" fill="url(#eyeGradIdle)" class="eye-layer" opacity="1" />
                      <circle id="eye-layer-listen" cx="130" cy="364" r="17.6" fill="url(#eyeGradListen)" class="eye-layer" opacity="0" />
                      <circle id="eye-layer-process" cx="130" cy="364" r="17.6" fill="url(#eyeGradProcess)" class="eye-layer" opacity="0" />
                      <circle id="eye-layer-respond" cx="130" cy="364" r="17.6" fill="url(#eyeGradRespond)" class="eye-layer" opacity="0" />
                      <circle id="eye-layer-dance" cx="130" cy="364" r="17.6" fill="url(#eyeGradDance)" class="eye-layer" opacity="0" />
                      <circle id="eye-center" cx="130" cy="364" r="6.6" fill="#ffe855" />
                      <circle cx="128" cy="362" r="2.2" fill="#ffffff" opacity="0.7" />
                      </g>
                    </g>
                    <g clip-path="url(#eyeballClip)">
                      <path id="eye-lid" d="m 80,200 h 100 v 164 h -24 a 26,26 0 0 0 -52,0 H 80 Z" fill="url(#lidGrad)" stroke="#000000" stroke-width="2"/>
                      <path id="eye-lid-bottom" d="M 80,500 H 180 V 364 h -24 a 26,26 0 0 1 -52,0 H 80 Z" fill="url(#lidGradFlip)" stroke="#000000" stroke-width="2"/>
                    </g>
                  </g>
                </g>
              </g>
              <path d="m 92,359 5,2 v 6 l -5,2 z" fill="#050505"/>
              <path d="m 92,379 5,2 v 8 l -5,2 z" fill="#050505"/>
              <rect id="danger-ring" x="97" y="283.25" width="66" height="161.5" rx="33" fill="none" stroke="#ff2200" stroke-width="2" opacity="0"/>
              <!-- Idle progress ring: same stadium outline as #danger-ring but
                   as a path starting at BOTTOM-CENTER (130,444.75) running
                   clockwise (left side first). pathLength=100 normalizes the
                   geometry so stroke-dasharray "N 100" fills exactly N%.
                   Separate element from #danger-ring so the responding-state
                   red flash and the idle progress fill never interact. -->
              <path id="progress-ring" d="M 130,444.75 A 33,33 0 0 1 97,411.75 L 97,316.25 A 33,33 0 0 1 130,283.25 A 33,33 0 0 1 163,316.25 L 163,411.75 A 33,33 0 0 1 130,444.75 Z" pathLength="100" fill="none" stroke="#ffcc00" stroke-width="2" stroke-linecap="round" stroke-dasharray="0 100" opacity="0"/>
              </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  `;
}

// src/animator.js
var AxidosAnimator = class {
  constructor(shadowRoot) {
    const root = shadowRoot;
    this.el = {
      svg: root.getElementById("axidos-svg"),
      head: root.getElementById("axidos-head"),
      headBop: root.getElementById("head-bop"),
      torsoSwivel: root.getElementById("torso-swivel"),
      hitbox: root.getElementById("hitbox"),
      eyeLayerIdle: root.getElementById("eye-layer-idle"),
      eyeLayerListen: root.getElementById("eye-layer-listen"),
      eyeLayerProcess: root.getElementById("eye-layer-process"),
      eyeLayerRespond: root.getElementById("eye-layer-respond"),
      eyeLayerDance: root.getElementById("eye-layer-dance"),
      eyeHalo: root.getElementById("eye-halo"),
      eyeCenter: root.getElementById("eye-center"),
      pupil: root.getElementById("eye-pupil"),
      eyeball: root.getElementById("eyeball-assembly"),
      bellows: root.getElementById("bellows"),
      lidTop: root.getElementById("eye-lid"),
      lidBot: root.getElementById("eye-lid-bottom"),
      dangerRing: root.getElementById("danger-ring"),
      progressRing: root.getElementById("progress-ring"),
      ledMatrices: root.querySelectorAll(".led-matrix")
    };
    this.ledVarTargets = [
      ...root.querySelectorAll(".led-matrix"),
      root.getElementById("ind-l1"),
      root.getElementById("ind-l2"),
      root.getElementById("ind-r1"),
      root.getElementById("ind-r2")
    ].filter(Boolean);
    this._lastLedColor = null;
    this._lastLedOpacity = null;
    this.currentBaseLid = 0;
    this.currentLedColor = "#ffb800";
    this.currentLedOpacity = "0.15";
    this._timers = /* @__PURE__ */ new Map();
    this._rafs = /* @__PURE__ */ new Map();
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
    if (id !== void 0) {
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
    if (id !== void 0) {
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
  setHead(rot, tx, ty, scale = 1, dur, ease = "cubic-bezier(0.34,1.06,0.64,1)") {
    this.el.head.style.transition = `transform ${dur}s ${ease}`;
    this.el.head.style.transform = `translate3d(${tx}px,${ty}px,0) rotate(${rot}deg) scale(${scale})`;
  }
  setBodySwivel(rot, sx, dur) {
    this.el.torsoSwivel.style.transition = `transform ${dur || 2}s cubic-bezier(0.45,0.05,0.55,0.95)`;
    this.el.torsoSwivel.style.transform = `rotate(${rot}deg) scaleX(${sx || 1})`;
  }
  resetBodySwivel() {
    this.el.torsoSwivel.style.transition = `transform 2.0s cubic-bezier(0.45,0.05,0.55,0.95)`;
    this.el.torsoSwivel.style.transform = "";
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
        if (t && t !== "none") {
          el.style.transition = "none";
          el.style.transform = t;
        } else {
          el.style.transition = "none";
        }
      } catch (err) {
      }
    }
  }
  /**
   * Ease-clear the bop layer transform (tap-bop spring layer on the head).
   * A short transition lets any residual displacement glide back to neutral
   * instead of snapping when the bop ends or a state change tears it down.
   */
  resetBopLayer() {
    if (this.el.headBop) {
      this.el.headBop.style.transition = "transform 0.4s ease-out";
      this.el.headBop.style.transform = "translate3d(0,0,0) rotate(0deg) scale(1)";
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
      el.style.setProperty("--led-color", color);
      el.style.setProperty("--led-opacity", opacity);
    }
  }
  setLEDs(color, opacity) {
    this.currentLedColor = color;
    this.currentLedOpacity = opacity;
    this.setLedVars(color, opacity);
  }
};

// src/behaviors/idle.js
function lidLoop(card, now) {
  const a = card.animator;
  const st = card._state;
  if (st !== "idle" && st !== "processing") return;
  if (now >= a._nextLidAt) {
    if (st === "idle") {
      const val = Math.max(0, Math.min(1, a.currentBaseLid + (Math.random() - 0.5) * 0.15));
      a.setLid(val, 0.5 + Math.random() * 0.8);
      a._nextLidAt = now + 1500 + Math.random() * 2500;
    } else {
      const val = 0.5 + Math.random() * 0.35;
      a.setLid(val, 0.15 + Math.random() * 0.25);
      a._nextLidAt = now + 120 + Math.random() * 280;
    }
  }
  a.requestRaf("lid-loop", (t) => lidLoop(card, t));
}
function startLidBehavior(card) {
  stopLidBehavior(card);
  card.animator._nextLidAt = 0;
  card.animator.requestRaf("lid-loop", (now) => lidLoop(card, now));
}
function stopLidBehavior(card) {
  card.animator.cancelRaf("lid-loop");
}
var IDLE_BEHAVIORS = [
  {
    name: "passive",
    exec(card, a) {
      a.setHead(0, 0, 0, 1, 2.4);
      a.setBaseLid(0, 1);
      a.resetBodySwivel();
    },
    min: 6e3,
    max: 13e3,
    weight: 4
  },
  {
    name: "scan_right",
    exec(card, a) {
      a.setHead(12, 0, -5, 0.98, 1.4);
      a.setBaseLid(0, 1);
      a.setBodySwivel(-2, 1, 1.8);
    },
    min: 3500,
    max: 7e3,
    weight: 1.5
  },
  {
    name: "scan_left",
    exec(card, a) {
      a.setHead(-12, 0, -5, 0.98, 1.4);
      a.setBaseLid(0, 1);
      a.setBodySwivel(2, 1, 1.8);
    },
    min: 3500,
    max: 7e3,
    weight: 1.5
  },
  {
    name: "curious",
    exec(card, a) {
      a.setHead(8, 0, -20, 1.05, 1.2);
      a.setBaseLid(0, 0.8);
      a.setBodySwivel(-2, 1, 1.6);
    },
    min: 4e3,
    max: 8e3,
    weight: 2
  },
  {
    name: "contemptuous",
    exec(card, a) {
      a.setHead(-6, 0, 15, 0.95, 1.8);
      a.setBaseLid(0.65, 1);
      a.setBodySwivel(1.5, 1, 2);
      a.setTimeout("idle-blink", () => {
        if (card._state === "idle") a.setBaseLid(0, 1.5);
      }, 1500);
    },
    min: 5e3,
    max: 1e4,
    weight: 2
  },
  {
    name: "alert",
    exec(card, a) {
      a.setHead(0, 0, -25, 1.08, 0.28);
      a.setBaseLid(0, 0.2);
      a.setBodySwivel(-1, 1, 0.4);
    },
    min: 1500,
    max: 3e3,
    weight: 1
  },
  {
    name: "bored",
    exec(card, a) {
      a.setHead(2, 0, 20, 0.96, 2.8);
      a.setBaseLid(0.7, 1.5);
      a.setBodySwivel(1, 1, 3);
      a.setTimeout("idle-blink", () => {
        if (card._state === "idle") a.setBaseLid(0, 1.5);
      }, 1500);
    },
    min: 7e3,
    max: 14e3,
    weight: 1.5
  },
  {
    name: "full_swivel",
    exec(card, a) {
      a.setBodySwivel(-6, 0.96, 2.5);
      a.setTimeout("idle-blink", () => {
        a.setHead(6, 0, -3, 1.02, 1.2);
        a.setBaseLid(0, 0.8);
      }, 600);
    },
    min: 4e3,
    max: 8e3,
    weight: 0.8
  },
  {
    name: "glitch",
    exec(card, a) {
      let count = 0, lastTime = 0;
      a.cancelRaf("idle-glitch");
      const glitchLoop = (timestamp) => {
        if (!lastTime) lastTime = timestamp;
        if (timestamp - lastTime > 60) {
          lastTime = timestamp;
          if (card._state !== "idle" || count > 12) {
            a.cancelRaf("idle-glitch");
            if (card._state === "idle") {
              a.el.eyeHalo.setAttribute("fill", "url(#haloGradIdle)");
              a.el.eyeCenter.setAttribute("fill", "#ffcc00");
              a.setHead(0, 0, 0, 1, 0.4);
            }
            return;
          }
          a.setHead((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 1, 0.05, "linear");
          if (count % 2 === 0) {
            a.el.eyeHalo.setAttribute("fill", "#110000");
            a.el.eyeCenter.setAttribute("fill", "#884400");
          } else {
            a.el.eyeHalo.setAttribute("fill", "#ffb800");
            a.el.eyeCenter.setAttribute("fill", "#ffffff");
          }
          count++;
        }
        a.requestRaf("idle-glitch", glitchLoop);
      };
      a.requestRaf("idle-glitch", glitchLoop);
    },
    min: 4e3,
    max: 7e3,
    weight: 0.3
  }
];
function dartPupil(card) {
  if (card._state === "idle") {
    const max = 7;
    card.animator.setPupil((Math.random() - 0.5) * max * 2, (Math.random() - 0.5) * max * 2);
    card.animator.setTimeout("idle-pupil", () => dartPupil(card), 600 + Math.random() * 2500);
  }
}
function runNextIdleBehavior(card) {
  if (card._state !== "idle") return;
  const a = card.animator;
  let r = Math.random() * IDLE_BEHAVIORS.reduce((s, b) => s + b.weight, 0);
  let chosen = IDLE_BEHAVIORS[0];
  for (const b of IDLE_BEHAVIORS) {
    r -= b.weight;
    if (r <= 0) {
      chosen = b;
      break;
    }
  }
  try {
    chosen.exec(card, a);
  } catch (err) {
  }
  a.setTimeout("idle-behavior", () => runNextIdleBehavior(card), chosen.min + Math.random() * (chosen.max - chosen.min));
}
function startIdleCycle(card) {
  stopIdleCycle(card);
  dartPupil(card);
  card.animator.setTimeout("idle-behavior", () => runNextIdleBehavior(card), 2e3 + Math.random() * 3e3);
}
function stopIdleHeadPoses(card) {
  card.animator.clearTimeout("idle-behavior");
  card.animator.clearTimeout("idle-blink");
  card.animator.cancelRaf("idle-glitch");
}
function startIdleHeadPoses(card) {
  if (card._state !== "idle") return;
  const a = card.animator;
  try {
    const t = getComputedStyle(a.el.head).transform;
    if (t && t !== "none") {
      a.el.head.style.transition = "transform 0.6s cubic-bezier(0.34,1.06,0.64,1)";
      a.el.head.style.transform = t;
    } else {
      a.el.head.style.transition = "";
    }
  } catch (err) {
  }
  a.clearTimeout("idle-behavior");
  a.setTimeout("idle-behavior", () => runNextIdleBehavior(card), 300 + Math.random() * 800);
}
function stopIdleCycle(card) {
  stopIdleHeadPoses(card);
  card.animator.clearTimeout("idle-pupil");
}

// src/behaviors/choreography.js
function hash32(n) {
  n = n ^ 61 ^ n >>> 16;
  n = n + (n << 3) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 668265261);
  n ^= n >>> 15;
  return n >>> 0;
}
function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = s + 1831565813 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var ENERGY_WINDOWS = [0.5, 0.75, 1, 0.6];
var ENERGY_MIN = 0.3;
var ENERGY_MAX = 1.1;
var DART_MAX = [3, 6, 6, 9];
function getEnergy(dancePhase) {
  const phase = (dancePhase % 64 + 64) % 64;
  const center = phase - 8;
  const seg = Math.floor(center / 16);
  const t = (center - seg * 16) / 16;
  const from = ENERGY_WINDOWS[(seg % 4 + 4) % 4];
  const to = ENERGY_WINDOWS[((seg + 1) % 4 + 4) % 4];
  const base = from + (to - from) * (0.5 - 0.5 * Math.cos(t * Math.PI));
  const wobble = 0.09 * Math.sin(2 * Math.PI * dancePhase / 97);
  return Math.min(ENERGY_MAX, Math.max(ENERGY_MIN, base + wobble));
}
var hit = (r, tx, ty, s, lid, durBeats, pump, dart) => ({
  r,
  tx,
  ty,
  s,
  lid,
  dart: dart || null,
  flow: false,
  durBeats,
  pump
});
var flow = (r, tx, ty, s, lid, durBeats, pump) => ({
  r,
  tx,
  ty,
  s,
  lid,
  dart: null,
  flow: true,
  durBeats,
  pump
});
var TIERS = [
  // ---- Tier 0: chill (< 90 BPM) — slow pair-held sways, all FLOW ----
  {
    phrases: [
      {
        name: "quad-tilt",
        energy: 0.45,
        pose(b, c) {
          const q = b - b % 2;
          const pos = q % 4 === 0 ? 1 : -1;
          return flow(pos * 8, pos * 5, 2, 1, 0.4, 2, c.isDown ? 2 : 0);
        }
      },
      {
        name: "vertical-bob",
        energy: 0.4,
        pose(b, c) {
          const q = b - b % 2;
          return flow(0, 0, q % 4 === 0 ? 15 : -5, 1, 0.4, 2, c.isDown ? 3 : 0);
        }
      },
      {
        name: "sway-bob",
        energy: 0.5,
        // ADAPTED (intent-restored): legacy r = sin(phase*PI/2)*6 evaluated
        // only on even beats is identically 0 — the lateral sway never
        // rendered. Restored as a pure sway (r = 0, tx on the sine) so tier 0
        // has its body-shift phrase; see the tier-3 asymmetry note below.
        pose(b, c) {
          const q = b - b % 2;
          return flow(
            0,
            Math.sin(q * Math.PI / 4) * 5,
            Math.cos(q * Math.PI / 4) * 8 + 4,
            1,
            0.4,
            2,
            c.isDown ? 2 : 0
          );
        }
      },
      {
        name: "slow-arc",
        energy: 0.5,
        pose(b, c) {
          const q = b - b % 2;
          const pos = q % 8 < 4 ? 1 : -1;
          return flow(pos * 10, pos * 4, 5, 1, 0.4, 2, c.isDown ? 2 : 0);
        }
      },
      {
        name: "rotation-sweep",
        energy: 0.55,
        pose(b, c) {
          const q = b - b % 2;
          return flow(Math.sin(q * Math.PI / 4) * 12, 0, 0, 1, 0.4, 2, c.isDown ? 2 : 0);
        }
      },
      {
        name: "dip-bob",
        energy: 0.45,
        pose(b, c) {
          const q = b - b % 2;
          const up = q % 4 === 0;
          return flow(up ? 4 : -4, 0, up ? 12 : 2, up ? 1.03 : 1, 0.4, 2, c.isDown ? 3 : 0);
        }
      },
      {
        name: "accent-nod",
        energy: 0.5,
        pose(b, c) {
          const q = b - b % 2;
          const m8 = q % 8;
          const r = m8 === 0 ? 12 : m8 === 4 ? -6 : 0;
          return flow(r, r * 0.5, 8, 1, 0.4, 2, c.isDown ? 3 : 0);
        }
      },
      {
        name: "settle-rest",
        energy: 0.2,
        halo: 0.8,
        pose(b, c) {
          return flow(0, 0, 2, 1.05, 0.5, 2, c.isDown ? 1 : 0);
        }
      }
    ]
  },
  // ---- Tier 1: groovy (90-125 BPM) — confident hits, every-beat alternation ----
  {
    phrases: [
      {
        name: "headbang",
        energy: 0.5,
        pose(b, c) {
          return hit(
            c.isDown ? 7 : -7,
            0,
            c.isDown ? 8 : -2,
            c.isDown ? 1.02 : 1,
            0.2,
            0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null
          );
        }
      },
      {
        name: "side-hold",
        energy: 0.5,
        pose(b, c) {
          const side = c.m4 < 2 ? 1 : -1;
          return hit(
            side * 8,
            side * 4,
            c.isDown ? 10 : 2,
            1,
            0.2,
            0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null
          );
        }
      },
      {
        name: "offbeat-lift",
        energy: 0.55,
        // Legacy overrode the tier easing with plain ease-in-out -> FLOW.
        pose(b, c) {
          const r = c.m4 === 0 ? 10 : c.m4 === 2 ? -10 : 0;
          return flow(
            r,
            0,
            c.m4 === 1 || c.m4 === 3 ? 12 : 0,
            1,
            0.2,
            0.8,
            c.isDown ? 2 : 0
          );
        }
      },
      {
        name: "array-tilt",
        energy: 0.6,
        pose(b, c) {
          return hit(
            [10, 5, -10, -5][c.m4],
            0,
            [0, 8, 0, 8][c.m4],
            1,
            0.2,
            0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null
          );
        }
      },
      {
        name: "pure-sway",
        energy: 0.5,
        pose(b, c) {
          return hit(
            0,
            c.isDown ? 8 : -8,
            4,
            1,
            0.2,
            0.8,
            c.isDown ? 2 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null
          );
        }
      },
      {
        name: "full-swing",
        energy: 0.6,
        pose(b, c) {
          return hit(
            c.isDown ? 10 : -10,
            c.isDown ? 5 : -5,
            c.isDown ? 10 : -5,
            1,
            0.2,
            0.8,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null
          );
        }
      },
      {
        name: "offbeat-loom",
        energy: 0.55,
        pose(b, c) {
          return hit(
            (c.isDown ? 1 : -1) * 6,
            0,
            !c.isDown ? 14 : 0,
            !c.isDown ? 1.04 : 1,
            0.2,
            0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null
          );
        }
      },
      {
        name: "triplet-side",
        energy: 0.6,
        // The one legacy block keyed on dancePhase % 3 — uses the GLOBAL beat
        // counter passed through the context.
        pose(b, c) {
          const side = c.global % 3 === 0 ? -1 : 1;
          return hit(
            side * 8,
            0,
            c.isDown ? 8 : 0,
            1,
            0.2,
            0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null
          );
        }
      }
    ]
  },
  // ---- Tier 2: club (125-160 BPM) — sharp snaps, tx arrays, punch-recover ----
  {
    phrases: [
      {
        name: "power-tilt",
        energy: 0.7,
        pose(b, c) {
          return hit(
            c.isDown ? 12 : -12,
            c.isDown ? 6 : -6,
            c.isDown ? 10 : -8,
            1.03,
            c.isDown ? 0.1 : 0,
            0.6,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null
          );
        }
      },
      {
        name: "lateral-stutter",
        energy: 0.65,
        pose(b, c) {
          return hit(
            0,
            [8, 0, -8, 0][c.m4],
            c.isDown ? 5 : -5,
            1,
            c.m4 === 3 ? 0.6 : c.isDown ? 0.1 : 0,
            0.6,
            c.isDown ? 3 : 0
          );
        }
      },
      {
        name: "scale-build",
        energy: 0.6,
        // Legacy excluded this block from pupil darts (its lid ramp IS the
        // accent) — preserved.
        pose(b, c) {
          return hit(
            c.isDown ? 5 : -5,
            0,
            c.isDown ? 5 : -2,
            1 + c.m4 * 0.03,
            0.4 - c.m4 * 0.1,
            0.6,
            c.isDown ? 3 : 0
          );
        }
      },
      {
        name: "big-snap",
        energy: 0.85,
        pose(b, c) {
          return hit(
            c.isDown ? 15 : -15,
            c.isDown ? 5 : -5,
            8,
            1,
            c.isDown ? 0.1 : 0,
            0.6,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null
          );
        }
      },
      {
        name: "square-wave",
        energy: 0.75,
        pose(b, c) {
          return hit(
            [10, 10, -10, -10][c.m4],
            [5, 5, -5, -5][c.m4],
            [8, -2, 8, -2][c.m4],
            1,
            c.isDown ? 0.1 : 0,
            0.6,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null
          );
        }
      },
      {
        name: "linear-thrust",
        energy: 0.7,
        pose(b, c) {
          return hit(
            (c.isDown ? 1 : -1) * 10,
            0,
            c.isDown ? 12 : 4,
            1.02,
            c.isDown ? 0.1 : 0,
            0.4,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null
          );
        }
      },
      {
        name: "hole-punch",
        energy: 0.75,
        pose(b, c) {
          const odd = c.m4 === 1 || c.m4 === 3;
          return hit(
            odd ? 0 : c.m4 === 0 ? 12 : -12,
            0,
            odd ? 14 : -2,
            1,
            c.isDown ? 0.1 : 0,
            0.6,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null
          );
        }
      },
      {
        name: "punch-recover",
        energy: 0.9,
        halo: 0.8,
        // Legacy texture, verbatim: the SAME pose on both beats, snapped on
        // the downbeat (0.1 beats) and recovered slowly on the off-beat
        // (0.8 beats).
        pose(b, c) {
          return hit(
            12,
            8,
            c.isDown ? 8 : -4,
            1,
            c.isDown ? 0.1 : 0,
            c.isDown ? 0.1 : 0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null
          );
        }
      }
    ]
  },
  // ---- Tier 3: hardcore (160+ BPM) — seeded chaos, strobe finale ----
  {
    phrases: [
      {
        // The tier's base groove (legacy block 0). Kept below the peak gate
        // (0.8) so the tier-3 gated pool is never empty in low-energy
        // windows — with every other phrase peak-gated, a pool containing
        // only jackhammer could dead-end into the random fallback and play
        // a wild phrase at groove energy.
        name: "slam",
        energy: 0.7,
        pose(b, c) {
          return hit(
            0,
            0,
            c.isDown ? 20 : -10,
            c.isDown ? 1.08 : 0.95,
            c.quad ? 0.4 : 0,
            0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      },
      {
        name: "chaos",
        energy: 1,
        // Legacy Math.random jerks -> seeded c.rnd() (determinism contract).
        // tx is drawn independently of r — the tier-3 "independent lateral"
        // phrase (tier 3 keeps its as-rendered vertical pump below instead of
        // a pure sway; chaos already owns the lateral texture).
        pose(b, c) {
          return hit(
            (c.rnd() - 0.5) * 30,
            (c.rnd() - 0.5) * 15,
            (c.rnd() - 0.5) * 15,
            1,
            c.quad ? 0.4 : 0,
            0.5,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      },
      {
        name: "whip",
        energy: 0.9,
        pose(b, c) {
          return hit(
            c.isDown ? 18 : -18,
            c.isDown ? 10 : -10,
            12,
            1,
            c.quad ? 0.4 : 0,
            0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      },
      {
        name: "glitch",
        energy: 1,
        halo: 0.8,
        pose(b, c) {
          return hit(
            c.isDown ? 10 : -10,
            (c.rnd() - 0.5) * 20,
            15,
            1.1,
            c.quad ? 0.4 : 0,
            0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      },
      {
        name: "assault",
        energy: 1,
        pose(b, c) {
          return hit(
            c.isDown ? 25 : -25,
            c.isDown ? 15 : -15,
            c.isDown ? 15 : -15,
            1,
            c.quad ? 0.4 : 0,
            0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      },
      {
        name: "jackhammer",
        energy: 0.8,
        pose(b, c) {
          return hit(
            0,
            0,
            c.isDown ? 12 : 2,
            1,
            c.quad ? 0.4 : 0,
            0.3,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      },
      {
        name: "pump",
        energy: 0.9,
        // ADAPTED (as-rendered): legacy ty = cos(phase*PI/2)*15+5 sampled at
        // integer beats is the period-4 sequence [20, 5, -10, 5]; the
        // authored r/tx sines (sin(phase*PI)) are identically 0 at integer
        // beats, so the block RENDERED as a pure vertical pump. Ported
        // as-rendered — tier 3's lateral texture comes from chaos/glitch.
        pose(b, c) {
          return hit(
            0,
            0,
            [20, 5, -10, 5][c.m4],
            1,
            c.quad ? 0.4 : 0,
            0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      },
      {
        name: "strobe-slam",
        energy: 1,
        halo: 0.8,
        strobe: true,
        // Legacy finale, verbatim: same pose held across the bar, snapped on
        // the m4===0 downbeat (0.1 beats) and recovered long (1.5 beats);
        // #eye-center strobes red/white every beat (dance.js).
        pose(b, c) {
          return hit(
            15,
            0,
            10,
            1.1,
            c.quad ? 0.4 : 0,
            c.m4 === 0 ? 0.1 : 1.5,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null
          );
        }
      }
    ]
  }
];
var PEAK_GATE = 0.8;
var PEAK_MARGIN = 0.3;
function pickNextPhrase(tierIdx, currentId, switchEnergy, phraseCount) {
  const tier = TIERS[tierIdx];
  const n = tier.phrases.length;
  const gated = [];
  const all = [];
  for (let i = 0; i < n; i++) {
    if (i === currentId) continue;
    all.push(i);
    const p = tier.phrases[i];
    if (p.energy <= PEAK_GATE || switchEnergy >= p.energy - PEAK_MARGIN) gated.push(i);
  }
  const pool = gated.length > 0 ? gated : all;
  const rnd = mulberry32(hash32(
    Math.imul(phraseCount + 1, 2654435761) ^ Math.imul(tierIdx + 1, 2246822519) ^ Math.imul(currentId + 1, 3266489917)
  ));
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}
function phraseVariant(tierIdx, phraseId, phraseCount) {
  const rnd = mulberry32(hash32(
    Math.imul(phraseCount + 1, 2654435761) ^ Math.imul(phraseId + 1, 668265263) ^ Math.imul(tierIdx + 1, 374761393)
  ));
  return { lead: rnd() < 0.5 ? 1 : -1, jitter: 0.9 + rnd() * 0.2 };
}
function getBeatPose(tierIdx, phraseId, b, variant, globalBeat) {
  const phrase = TIERS[tierIdx].phrases[phraseId];
  const isDown = b % 2 === 0;
  const rnd = mulberry32(hash32(
    Math.imul(phraseId + 1, 7919) ^ Math.imul(b + 1, 104729) ^ Math.imul(tierIdx + 1, 7)
  ));
  const raw = phrase.pose(b, {
    isDown,
    quad: b % 4 === 0,
    m4: b % 4,
    m8: b % 8,
    lead: variant.lead,
    global: globalBeat,
    rnd
  });
  const k = variant.jitter;
  const dartMax = DART_MAX[tierIdx];
  let dart = raw.dart;
  if (dart) {
    const len = Math.hypot(dart[0], dart[1]);
    if (len > dartMax) {
      const f = dartMax / len;
      dart = [dart[0] * f, dart[1] * f];
    }
  }
  return {
    r: raw.r * k,
    tx: raw.tx * k,
    ty: raw.ty * k,
    s: 1 + (raw.s - 1) * k,
    lid: raw.lid,
    pump: raw.pump * k,
    flow: raw.flow,
    flowBlend: raw.flow ? 1 : 0,
    durBeats: raw.durBeats,
    dart,
    halo: phrase.halo,
    strobe: phrase.strobe === true
  };
}

// src/behaviors/dance.js
var DANCE_EASINGS = {
  hitDown: "cubic-bezier(0.34, 1.4, 0.64, 1)",
  hitOff: "cubic-bezier(0.2, 0.9, 0.3, 1)",
  flow: "cubic-bezier(0.42, 0, 0.58, 1)"
};
var HIT_DOWN_EASE = DANCE_EASINGS.hitDown;
var HIT_OFF_EASE = DANCE_EASINGS.hitOff;
var FLOW_EASE = DANCE_EASINGS.flow;
function startDanceCycle(card, bpm) {
  const a = card.animator;
  stopDanceCycle(card);
  let dancePhase = 0;
  let currentBpm = Math.max(60, Math.min(200, bpm));
  let beatMs = 60 / currentBpm * 1e3;
  let beatSec = beatMs / 1e3;
  let expectedNextTick = performance.now() + beatMs;
  const tierIdx = tierForBpm(currentBpm);
  const eyeHitScale = [1.06, 1.1, 1.18, 1.25][tierIdx];
  card._retuneDance = (newBpm) => {
    const nb = Math.max(60, Math.min(200, newBpm));
    if (tierForBpm(nb) !== tierIdx) return false;
    if (nb === currentBpm) return true;
    currentBpm = nb;
    beatMs = 60 / nb * 1e3;
    beatSec = beatMs / 1e3;
    expectedNextTick = performance.now() + beatMs;
    return true;
  };
  let phraseId = 0;
  let phraseCount = 0;
  let variant = phraseVariant(tierIdx, phraseId, phraseCount);
  let lastLedOpacity = null;
  let lastHalo = null;
  let lastStrobeFill = null;
  const step = () => {
    if (card._state !== "dancing") return;
    const executeTick = () => {
      dancePhase++;
      const now = performance.now();
      if (now > expectedNextTick + beatMs) {
        expectedNextTick = now;
      } else {
        expectedNextTick += beatMs;
      }
      const delay = Math.max(0, expectedNextTick - now);
      a.setTimeout("dance-step", step, delay);
    };
    if (card._danceHeld) {
      executeTick();
      return;
    }
    const b = dancePhase % 16;
    if (b === 0 && dancePhase > 0) {
      phraseId = pickNextPhrase(tierIdx, phraseId, getEnergy(dancePhase), phraseCount);
      phraseCount++;
      variant = phraseVariant(tierIdx, phraseId, phraseCount);
    }
    const isDownBeat = b % 2 === 0;
    const move = getBeatPose(tierIdx, phraseId, b, variant, dancePhase);
    if (lastLedOpacity !== "1") {
      a.setLEDs("#1DB954", "1");
      lastLedOpacity = "1";
    }
    const halo = move.halo ? String(move.halo) : "0.5";
    if (lastHalo !== halo) {
      a.el.eyeHalo.style.opacity = halo;
      lastHalo = halo;
    }
    if (move.strobe) {
      const fill = isDownBeat ? "#ff0000" : "#ffffff";
      if (lastStrobeFill !== fill) {
        a.el.eyeCenter.setAttribute("fill", fill);
        lastStrobeFill = fill;
      }
    } else if (lastStrobeFill !== null && lastStrobeFill !== "#ffffff") {
      a.el.eyeCenter.setAttribute("fill", "#ffffff");
      lastStrobeFill = "#ffffff";
    }
    a.el.eyeCenter.style.transform = `scale(${eyeHitScale})`;
    a.setBellows(move.pump, 0.12);
    a.setTimeout("dance-led", () => {
      if (card._state === "dancing") {
        if (lastLedOpacity !== "0.15") {
          a.setLEDs("#1DB954", "0.15");
          lastLedOpacity = "0.15";
        }
        a.el.eyeHalo.style.opacity = "0.05";
        lastHalo = "0.05";
        a.el.eyeCenter.style.transform = "scale(1)";
        a.setBellows(0, 0.3);
      }
    }, beatMs * 0.3);
    if (tierIdx === 1) {
      const sr = mulberryFrom(hash32(dancePhase + 1));
      a.setTimeout("dance-sync", () => {
        if (card._state !== "dancing") return;
        a.setPupil((sr() - 0.5) * 4, (sr() - 0.5) * 3);
      }, beatMs * 0.5);
    }
    const maxBeats = move.flow ? FLOW_CLAMP_BEATS : HIT_CLAMP_BEATS;
    let moveDur = Math.min(move.durBeats * beatSec, beatSec * maxBeats);
    const ease = move.flow ? FLOW_EASE : isDownBeat ? HIT_DOWN_EASE : HIT_OFF_EASE;
    a.setHead(move.r, move.tx, move.ty, move.s, moveDur, ease);
    if (move.dart) a.setPupil(move.dart[0], move.dart[1]);
    a.setBodySwivel(move.r * -0.5, 1, beatSec * 3);
    const lid = Math.max(move.lid, currentBpm < 125 ? 0.15 : 0.08);
    a.setBaseLid(lid, beatSec * 0.5);
    executeTick();
  };
  step();
}
function mulberryFrom(seed) {
  let s = seed >>> 0;
  return function() {
    s = s + 1831565813 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var HIT_CLAMP_BEATS = 2;
var FLOW_CLAMP_BEATS = 1.9;
function tierForBpm(bpm) {
  return bpm < 90 ? 0 : bpm < 125 ? 1 : bpm < 160 ? 2 : 3;
}
function stopDanceCycle(card) {
  const a = card.animator;
  a.clearTimeout("dance-step");
  a.clearTimeout("dance-led");
  a.clearTimeout("dance-sync");
  delete card._retuneDance;
  if (a.el.eyeCenter) a.el.eyeCenter.setAttribute("fill", "#ffffff");
  a.setBellows(0, 0.3);
}

// src/behaviors/talk.js
var TALK_MOVES = [
  { r: -10, tx: -8, ty: -18, s: 1.02, dur: 1.8, lid: 0.1, px: 0, py: -2 },
  { r: 4, tx: 0, ty: 16, s: 1.08, dur: 1.2, lid: 0.85, px: 0, py: 4 },
  { r: 2, tx: 0, ty: 10, s: 1.04, dur: 1, lid: 0.5, px: 0, py: 2 },
  { r: 12, tx: 10, ty: -12, s: 0.96, dur: 2.2, lid: 0.1, px: 0, py: -1 },
  { r: 0, tx: 0, ty: 25, s: 1.1, dur: 1.8, lid: 0.9, px: 0, py: 5 },
  { r: -6, tx: 6, ty: -22, s: 0.98, dur: 1, lid: 0.1, px: 0, py: -3 },
  { r: 4, tx: -3, ty: 6, s: 1.03, dur: 2, lid: 0.4, px: 0, py: 1 },
  { r: -3, tx: 0, ty: 22, s: 1.15, dur: 1.2, lid: 0.95, px: 0, py: 6 },
  { r: 6, tx: 3, ty: -6, s: 1, dur: 1.5, lid: 0.2, px: 0, py: 0 }
];
function startTalkAnim(card) {
  const a = card.animator;
  a.clearTimeout("talk-step");
  let talkPhase = 0;
  const step = () => {
    const m = TALK_MOVES[talkPhase % TALK_MOVES.length];
    a.setHead(m.r, m.tx, m.ty, m.s, m.dur, "ease-in-out");
    a.setLid(m.lid, m.dur);
    a.setPupil(m.px, m.py);
    a.setBodySwivel(m.r * -0.6, 1, m.dur);
    talkPhase++;
    a.setTimeout("talk-step", step, m.dur * 1e3);
  };
  step();
}
function stopTalkAnim(card) {
  card.animator.clearTimeout("talk-step");
}

// src/behaviors/spring.js
var TIME_STEP = 16.666;
function createSpring({ omega, dampingRatio, settleThreshold = 0.08 }) {
  const stiffness = omega * omega;
  const damping = 2 * omega * dampingRatio;
  const spring = {
    position: 0,
    velocity: 0,
    _accumulator: 0,
    injectVelocity(v) {
      spring.velocity += v;
    },
    /**
     * Energy-add kick: boost the spring by one kick's worth of kinetic
     * energy WITHOUT cancelling its current motion. The new velocity keeps
     * the current direction and gains magnitude:
     *   v' = sign(v) * sqrt(v^2 + v0^2)
     * so a tap ALWAYS amplifies the bounce — tapping while the head is
     * rising (negative v) no longer partially cancels the injected energy
     * the way injectVelocity(+v0) did. At the extremes (v = 0) this
     * degenerates to a plain injection.
     *
     * `maxVelocity` (optional) clamps the result so rapid clicking cannot
     * accumulate unbounded amplitude and launch the head off-screen.
     */
    kick(v0, maxVelocity) {
      const v = spring.velocity;
      const sign = v >= 0 ? 1 : -1;
      let boosted = sign * Math.sqrt(v * v + v0 * v0);
      if (maxVelocity !== void 0 && Math.abs(boosted) > maxVelocity) {
        boosted = sign * maxVelocity;
      }
      spring.velocity = boosted;
    },
    reset() {
      spring.position = 0;
      spring.velocity = 0;
      spring._accumulator = 0;
    },
    /**
     * Advance the simulation by dtMs of wall time using fixed sub-steps.
     * Returns true once the spring has settled (pos & vel below threshold).
     */
    step(dtMs) {
      spring._accumulator += dtMs;
      let settled = true;
      let stepped = false;
      while (spring._accumulator >= TIME_STEP) {
        stepped = true;
        const force = -stiffness * spring.position - damping * spring.velocity;
        spring.velocity += force;
        spring.position += spring.velocity;
        spring._accumulator -= TIME_STEP;
        if (Math.abs(spring.position) >= settleThreshold || Math.abs(spring.velocity) >= settleThreshold) {
          settled = false;
        }
      }
      return settled && stepped;
    }
  };
  return spring;
}

// src/behaviors/bop.js
function pauseBackground(card, isDancing) {
  card.animator.freezeHeadMotion();
  if (isDancing) {
    card._danceHeld = true;
  } else {
    stopIdleHeadPoses(card);
  }
}
function resumeBackground(card, isDancing) {
  if (isDancing) {
    card._danceHeld = false;
  } else if (card._state === "idle") {
    startIdleHeadPoses(card);
  }
}
function bopHead(card) {
  const a = card.animator;
  const config = card.config;
  const backendSpeed = config.tap_speed !== void 0 ? parseFloat(config.tap_speed) : 0.5;
  const bounces = Math.max(1, Math.min(20, config.tap_bounces !== void 0 ? parseInt(config.tap_bounces) : 5));
  const intensity = config.tap_intensity !== void 0 ? parseFloat(config.tap_intensity) : 1;
  const resumeFrac = config.tap_bop_resume !== void 0 ? parseFloat(config.tap_bop_resume) : 0.3;
  const maxAmp = 15 * intensity;
  const omega = 0.28 * Math.max(0.01, backendSpeed);
  const dampingRatio = Math.min(0.7, 0.6 / bounces);
  const initialVelocity = maxAmp * omega * 1.8;
  const isDancing = card._state === "dancing";
  const maxVelocity = 2.5 * maxAmp * omega;
  if (card._bopping && card._bopSpring) {
    card._bopSpring.kick(initialVelocity, maxVelocity);
    pauseBackground(card, isDancing);
    card._bopResumeArmed = false;
    card._bopResumed = false;
    card._bopMaxSeen = 0;
    card._bopPeakFrozen = false;
    return;
  }
  pauseBackground(card, isDancing);
  const savedLedColor = a.currentLedColor;
  const savedLedOpacity = a.currentLedOpacity;
  const spring = createSpring({ omega, dampingRatio });
  spring.injectVelocity(initialVelocity);
  card._bopSpring = spring;
  card._bopping = true;
  let lastTime = performance.now();
  let lastLedUpdate = 0;
  let lastWrittenTransform = "";
  a.cancelRaf("bop-raf");
  card._bopMaxSeen = 0;
  card._bopPeakFrozen = false;
  const animate = (now) => {
    if (!card._bopping) return;
    let frameTime = now - lastTime;
    lastTime = now;
    if (frameTime > 100) frameTime = 16.666;
    const settled = spring.step(frameTime);
    if (settled) {
      card._bopping = false;
      card._bopSpring = null;
      a.resetBopLayer();
      if (!isDancing) a.setLEDs(savedLedColor, savedLedOpacity);
      if (!card._bopResumed) resumeBackground(card, isDancing);
      card._bopResumeArmed = false;
      card._bopResumed = false;
      card._bopPeakFrozen = false;
      return;
    }
    const ty = spring.position;
    const rot = spring.position * 0.15;
    const scale = 1 - Math.abs(spring.position) * 3e-3;
    if (a.el.headBop) {
      const t = `translate3d(0, ${ty.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      if (t !== lastWrittenTransform) {
        a.el.headBop.style.transition = "none";
        a.el.headBop.style.transform = t;
        lastWrittenTransform = t;
      }
    }
    if (!card._bopPeakFrozen) {
      if (Math.abs(spring.position) > card._bopMaxSeen) {
        card._bopMaxSeen = Math.abs(spring.position);
      }
      if (spring.velocity < 0) {
        card._bopPeakFrozen = true;
      }
    }
    const threshold = card._bopMaxSeen * resumeFrac;
    if (!card._bopResumeArmed && Math.abs(spring.position) > threshold) {
      card._bopResumeArmed = true;
    }
    if (!card._bopResumed && card._bopResumeArmed && Math.abs(spring.position) <= threshold) {
      card._bopResumed = true;
      resumeBackground(card, isDancing);
    }
    if (!isDancing && now - lastLedUpdate > 60) {
      lastLedUpdate = now;
      const normPos = Math.min(1, Math.abs(spring.position) / maxAmp);
      const baseOp = parseFloat(savedLedOpacity) || 0.15;
      const ledOp = baseOp + (1 - baseOp) * normPos;
      a.setLedVars(savedLedColor, ledOp.toFixed(2));
    }
    a.requestRaf("bop-raf", animate);
  };
  a.requestRaf("bop-raf", animate);
}
function stopBop(card) {
  const wasBopping = card._bopping;
  card._bopping = false;
  card._bopSpring = null;
  card._bopResumeArmed = false;
  card._bopResumed = false;
  card._bopMaxSeen = 0;
  card._bopPeakFrozen = false;
  card._danceHeld = false;
  card.animator.cancelRaf("bop-raf");
  if (wasBopping) card.animator.resetBopLayer();
}

// src/states.js
function resetAll(card) {
  const a = card.animator;
  stopTalkAnim(card);
  stopLidBehavior(card);
  stopIdleCycle(card);
  stopDanceCycle(card);
  stopBop(card);
  a.el.ledMatrices.forEach((m) => m.classList.remove("pulsing"));
  if (a.el.dangerRing) a.el.dangerRing.setAttribute("opacity", "0");
  if (a.el.progressRing) a.el.progressRing.setAttribute("opacity", "0");
  a.el.eyeLayerIdle.style.opacity = "0";
  a.el.eyeLayerListen.style.opacity = "0";
  a.el.eyeLayerProcess.style.opacity = "0";
  a.el.eyeLayerRespond.style.opacity = "0";
  a.el.eyeLayerDance.style.opacity = "0";
  a.el.eyeCenter.style.transform = "scale(1)";
  a.el.eyeCenter.style.transition = "fill 0.8s ease-in-out";
}
function applyStateVisuals(card, state, bpm) {
  const a = card.animator;
  resetAll(card);
  if (state === "idle") {
    a.el.eyeLayerIdle.style.opacity = "1";
    a.el.eyeHalo.style.transition = "fill 0.8s ease-in-out, opacity 0.8s";
    a.el.eyeHalo.setAttribute("fill", "url(#haloGradIdle)");
    a.el.eyeHalo.style.opacity = "0.05";
    a.el.eyeCenter.setAttribute("fill", "#ffcc00");
    a.setHead(0, 0, 0, 1, 2.2);
    a.setLid(0, 1.2);
    a.setPupil(0, 0);
    a.currentBaseLid = 0;
    a.setLEDs("#ffb800", "0.15");
    a.resetBodySwivel();
    updateProgressRing(card);
    startLidBehavior(card);
    startIdleCycle(card);
  } else if (state === "dancing") {
    a.el.eyeLayerDance.style.opacity = "1";
    a.el.eyeHalo.style.transition = "fill 0.8s ease-in-out, opacity 0.15s ease-out";
    a.el.eyeHalo.setAttribute("fill", "url(#haloGradDance)");
    a.el.eyeCenter.setAttribute("fill", "#ffffff");
    a.el.eyeCenter.style.transformOrigin = "130px 364px";
    a.el.eyeCenter.style.transition = "transform 0.1s ease-out, fill 0.8s ease-in-out";
    a.setLEDs("#1DB954", "0.15");
    a.resetBodySwivel();
    startDanceCycle(card, bpm);
  } else if (state === "listening") {
    a.el.eyeLayerListen.style.opacity = "1";
    a.el.eyeHalo.style.transition = "fill 0.8s ease-in-out, opacity 0.8s";
    a.el.eyeHalo.setAttribute("fill", "url(#haloGradListen)");
    a.el.eyeHalo.style.opacity = "0.05";
    a.el.eyeCenter.setAttribute("fill", "#aaffff");
    a.setHead(4, 0, -8, 1.06, 1);
    a.setBaseLid(0.1, 0.4);
    a.setPupil(0, -3);
    a.setLEDs("#00ccff", "1");
    a.setBodySwivel(-2, 1, 1.4);
  } else if (state === "processing") {
    a.el.eyeLayerProcess.style.opacity = "1";
    a.el.eyeHalo.style.transition = "fill 0.8s ease-in-out, opacity 0.8s";
    a.el.eyeHalo.setAttribute("fill", "url(#haloGradProcess)");
    a.el.eyeHalo.style.opacity = "0.05";
    a.el.eyeCenter.setAttribute("fill", "#ffddaa");
    a.setHead(-2, 0, 10, 0.96, 1.4);
    a.setBaseLid(0.65, 0.5);
    a.setLEDs("#ff6600", "1");
    a.setBodySwivel(1, 0.98, 1.8);
    a.el.ledMatrices.forEach((m) => m.classList.add("pulsing"));
    startLidBehavior(card);
    const dart = () => {
      if (card._state !== "processing") return;
      a.setPupil((Math.random() - 0.5) * 12, 4);
      a.setTimeout("process-dart", dart, 200 + Math.random() * 600);
    };
    dart();
  } else if (state === "responding") {
    a.el.eyeLayerRespond.style.opacity = "1";
    a.el.eyeHalo.style.transition = "fill 0.8s ease-in-out, opacity 0.8s";
    a.el.eyeHalo.setAttribute("fill", "url(#haloGradRespond)");
    a.el.eyeHalo.style.opacity = "0.05";
    a.el.eyeCenter.setAttribute("fill", "#ffaaaa");
    if (a.el.dangerRing) a.el.dangerRing.setAttribute("opacity", "1");
    a.setLEDs("#ff2200", "1");
    a.setBodySwivel(0, 1, 0.8);
    startTalkAnim(card);
  }
}
function updateProgressRing(card) {
  const a = card.animator;
  const ring = a.el.progressRing;
  if (!ring) return;
  const pct = card._progressPct;
  const enabled = card.config.progress_ring_enabled !== false && card.config.progress_entity && pct !== null && pct !== void 0;
  if (!enabled) {
    ring.setAttribute("opacity", "0");
    return;
  }
  const dynamic = card.config.progress_dynamic_color === true;
  const inverted = card.config.progress_invert_color === true;
  ring.setAttribute(
    "stroke-dasharray",
    card.config.progress_vertical_fill !== false ? verticalProgressDash(pct) : `${pct} 100`
  );
  ring.setAttribute("stroke", progressColor(pct, dynamic, inverted));
  ring.setAttribute("opacity", "1");
}
function applyState(card, mapped, bpm) {
  const a = card.animator;
  a.clearTimeout("respond-delay");
  const delaySeconds = card.config.respond_delay !== void 0 ? parseFloat(card.config.respond_delay) : 0;
  if (mapped === "responding" && card._state !== "responding" && delaySeconds > 0) {
    a.setTimeout("respond-delay", () => {
      card._state = "responding";
      applyStateVisuals(card, "responding", bpm);
    }, delaySeconds * 1e3);
    return;
  }
  card._state = mapped;
  applyStateVisuals(card, mapped, bpm);
}

// src/axidos-card.js
var AxidosCard = class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._lastHassVoice = null;
    this._lastHassMedia = null;
    this._lastHassBpm = null;
    this._lastHassProgress = null;
    this._progressPct = null;
    this._state = "idle";
    this._currentBpm = 120;
    this._bopping = false;
    this._bopSpring = null;
    this.animator = null;
    this.contentReady = false;
  }
  // Native HA form editor: HA renders <ha-form> from this schema (same
  // mechanism mushroom cards use). Schema + labels live in editor.js.
  static getConfigForm() {
    return buildEditorForm();
  }
  static getStubConfig() {
    return getStubConfig();
  }
  setConfig(config) {
    this.config = sanitizeConfig(config);
    if (this.contentReady) {
      const prevState = this._state;
      this._teardownAnimation();
      this.setupDOM();
      this.initAxidos();
      applyState(this, prevState || "idle", this._currentBpm);
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
    const newVoiceState = entity && hass.states[entity] ? hass.states[entity].state.toLowerCase() : "idle";
    const newMediaState = mediaEntity && hass.states[mediaEntity] ? hass.states[mediaEntity].state.toLowerCase() : "paused";
    const newBpmState = bpmEntity && hass.states[bpmEntity] ? hass.states[bpmEntity].state : "120";
    const newProgressState = progressEntity && hass.states[progressEntity] ? hass.states[progressEntity].state : null;
    if (this._lastHassVoice === newVoiceState && this._lastHassMedia === newMediaState && this._lastHassBpm === newBpmState && this._lastHassProgress === newProgressState) return;
    this._lastHassVoice = newVoiceState;
    this._lastHassMedia = newMediaState;
    this._lastHassBpm = newBpmState;
    this._lastHassProgress = newProgressState;
    const prevProgress = this._progressPct;
    this._progressPct = parseProgress(newProgressState);
    if (this._state === "idle" && this._progressPct !== prevProgress) {
      updateProgressRing(this);
    }
    const currentBpm = parseBpm(newBpmState);
    const mapped = resolveState(newVoiceState, newMediaState);
    if (this._state !== mapped) {
      this._currentBpm = currentBpm;
      applyState(this, mapped, currentBpm);
    } else if (mapped === "dancing" && this._currentBpm !== currentBpm) {
      this._currentBpm = currentBpm;
      const retuned = typeof this._retuneDance === "function" && this._retuneDance(currentBpm);
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
    const rows = Math.max(4, Math.ceil((320 * scale + 24) / 80));
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
      document.addEventListener("visibilitychange", this._boundVisibility);
    }
    if (this.contentReady) {
      if (this._hitbox) {
        if (this._tapHandler) this._hitbox.addEventListener("click", this._tapHandler);
        if (this._keyHandler) this._hitbox.addEventListener("keydown", this._keyHandler);
      }
      const pivots = this.shadowRoot.querySelectorAll("#body-pivot, #head-sway-pivot");
      pivots.forEach((p) => {
        p.style.animation = "none";
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pivots.forEach((p) => {
            p.style.animation = "";
          });
        });
      });
      if (this._state) {
        applyState(this, this._state, this._currentBpm);
      }
    }
  }
  disconnectedCallback() {
    if (this._hitbox) {
      if (this._tapHandler) this._hitbox.removeEventListener("click", this._tapHandler);
      if (this._keyHandler) this._hitbox.removeEventListener("keydown", this._keyHandler);
    }
    this._teardownAnimation();
    if (this._boundVisibility) {
      document.removeEventListener("visibilitychange", this._boundVisibility);
    }
  }
  setupDOM() {
    this.shadowRoot.innerHTML = buildTemplate(this.config);
  }
  initAxidos() {
    this.animator = new AxidosAnimator(this.shadowRoot);
    this._hitbox = this.animator.el.hitbox;
    if (this._tapHandler && this._hitbox) {
      this._hitbox.removeEventListener("click", this._tapHandler);
    }
    this._tapHandler = (e) => {
      if (this.config.tap_enabled === false) return;
      e.stopPropagation();
      e.preventDefault();
      try {
        bopHead(this);
      } catch (err) {
        console.warn("axidos-card: bop failed", err);
      }
      const actionObj = this.config.tap_action || { action: "none" };
      if (actionObj.action === "none") return;
      const ev = new Event("hass-action", { bubbles: true, composed: true });
      ev.detail = {
        config: this.config,
        action: "tap"
      };
      this.dispatchEvent(ev);
    };
    if (this.config.tap_enabled !== false) {
      this._hitbox.style.display = "block";
    }
    this._hitbox.addEventListener("click", this._tapHandler);
    if (this._keyHandler && this._hitbox) {
      this._hitbox.removeEventListener("keydown", this._keyHandler);
    }
    this._keyHandler = (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        if (e.key === " ") e.preventDefault();
        this._tapHandler(e);
      }
    };
    this._hitbox.addEventListener("keydown", this._keyHandler);
    this._visibilityHandler = () => {
      if (!this.isConnected) return;
      if (document.hidden) {
        this._teardownAnimation();
        this.animator.el.svg.style.animationPlayState = "paused";
        this.animator.el.svg.querySelectorAll("#body-pivot, #head-sway-pivot").forEach((e) => {
          e.style.animationPlayState = "paused";
        });
      } else {
        this.animator.el.svg.style.animationPlayState = "";
        this.animator.el.svg.querySelectorAll("#body-pivot, #head-sway-pivot").forEach((e) => {
          e.style.animationPlayState = "";
        });
        applyState(this, this._state, this._currentBpm || 120);
      }
    };
    if (this._boundVisibility) document.removeEventListener("visibilitychange", this._boundVisibility);
    this._boundVisibility = this._visibilityHandler;
    document.addEventListener("visibilitychange", this._boundVisibility);
    applyState(this, "idle", 120);
  }
};

// src/index.js
customElements.define("axidos-card", AxidosCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "axidos-card")) {
  window.customCards.push({
    type: "axidos-card",
    name: "AXiDOS Avatar Card",
    preview: true,
    description: "A responsive, animated AXiDOS avatar card that reacts to voice and dances to music.",
    documentationURL: "https://github.com/Axildor/AXiDOS-Avatar-Card"
  });
}
