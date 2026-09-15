/**
 * template.js — Shadow DOM markup: CSS + inline SVG.
 * This is the ONLY file containing the AXiDOS model artwork.
 * buildTemplate(config) returns the full innerHTML string for setupDOM().
 */

export function buildTemplate(config) {
  const zoom = config.zoom !== undefined ? config.zoom : 85;
  const scale = zoom / 100;
  const width = 280 * scale;
  const height = 320 * scale;
  const bgStyle = config.transparent_bg
    ? 'background: transparent; box-shadow: none; border: none;'
    : 'background: var(--ha-card-background, var(--card-background-color, #1c1c1c));';

  return `
    <style>
      :host { display: flex; align-items: center; justify-content: center; ${bgStyle} border-radius: var(--ha-card-border-radius, 12px); overflow: hidden; width: 100%; }
      /* contain: layout paint — repaints inside the card never invalidate the
         dashboard around it (and vice versa) on weak tablet GPUs. */
      /* flex: none — the scene keeps its exact zoomed px size; a flex item
         would otherwise shrink back to the slot width at zoom > 100, and the
         SVG's preserveAspectRatio would pin the model at ~100%. getGridOptions()
         grows the slot (rows AND columns) to match. */
      #scene { position: relative; flex: none; width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center; contain: layout paint; }

      #hitbox { position: absolute; inset: 0; z-index: 100; cursor: pointer; display: none; }
      /* isolation: isolate — the SVG forms its own stacking context so its
         compositor layers don't interleave with the rest of the dashboard. */
      #axidos-svg { width: 100%; height: 100%; display: block; overflow: visible; pointer-events: none; isolation: isolate; --led-color: #ffb800; --led-opacity: 0.15; }

      /* ---- Compositor-layer promotion ----
         Every group animated via transform gets will-change: transform so the
         browser hoists it to its own GPU layer: per-frame transform writes
         (RAF spring loop, CSS transitions) then composite on the GPU instead
         of triggering main-thread SVG repaints. Applied ONLY to groups that
         actually animate — each hint costs GPU memory. Includes the ambient
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
               5.4 px translation budget — dance darts can request more.
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
                     cost). Static — rasterized once. -->
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
                         of #eye-pupil — a clip on the pupil itself would
                         translate along with it and clip nothing. -->
                    <g clip-path="url(#socketClip)">
                      <g id="eye-pupil" style="transition: transform 0.15s ease-out;">
                      <!-- Pre-blurred glow halo (rasterized once) replaces the
                           per-frame feGaussianBlur that used to sit on each
                           eye layer — visually equivalent soft edge, zero
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
              </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  `;
}