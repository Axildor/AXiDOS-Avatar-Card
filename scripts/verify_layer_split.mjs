/**
 * verify_layer_split.mjs — Verification of the 5.7.0-beta.3 layer split
 * (the motion-jank fix): the single inline SVG is now 5 stacked
 * absolutely-positioned SVGs in #scene (1 defs-only backdrop + 4 movers).
 *
 * Sections:
 *  1. Structure: exactly 5 svg.axidos-layer elements, z-order 0–4, hitbox
 *     z-100 on top, #scene keeps position: relative + contain.
 *  2. Identical viewBox: every layer carries viewBox="0 116 280 320" —
 *     px transform-origins + transform-box: view-box stay valid per layer.
 *  3. Backdrop purity: the backdrop layer contains ONLY <defs> — zero
 *     painted geometry (no shape elements outside defs).
 *  4. Mirror chains (C1/C2): #axidos-head, #head-bop, #torso-swivel exist
 *     in exactly 2 layers each (primary + mirror); #body-pivot and
 *     #head-sway-pivot exist in exactly 2 layers each (CSS keyframes hit
 *     all copies via id selectors).
 *  5. Mover CSS hygiene: no fill/color transitions inside mover layers —
 *     the variant stacks (.eye-center-variant / .eye-halo-variant) carry
 *     the fills; only transform/opacity animate in movers.
 *  6. Variant stacks: bounded sets (EYE_CENTER_VARIANTS / EYE_HALO_VARIANTS)
 *     match the painted circles 1:1, each with a 'dynamic' fallback.
 *  7. A1 concurrent crossfade: setEyeCenterColor/setEyeHaloFill write the
 *     incoming 0→1 and outgoing 1→0 opacities in the SAME call (same frame);
 *     out-of-set values ride the 'dynamic' fallback (fill written directly).
 *  8. A3a write-parity: setHead/setBodySwivel/resetBopLayer write ALL
 *     copies of their duplicated pivot groups (primary + mirror) with
 *     IDENTICAL values over a full sway+pose+bop cycle.
 *  9. A3b cross-layer register: the LED layer's mirror chain carries the
 *     identical #body-pivot > #torso-swivel > #torso transform attribute
 *     chain as the body layer (both track the same chain from different
 *     layers — the only cross-layer geometric register risk).
 * 10. A3c defs audit: auditCrossSvgDefs() returns [] on the live template
 *     (every url(#…) resolves in the backdrop defs host); a template with
 *     a broken reference trips the audit (the fallback must not fail
 *     silently).
 * 11. dprfix retirement (A2): dprFixStyles is GONE from template.js; the
 *     debug_dprfix key stays accepted (sanitize) and setupDOM injects
 *     nothing (no scale wrapper ported to any layer).
 * 12. Animator refs: el.svgs = 5 layers; el.head/headBop/torsoSwivel are
 *     arrays of the right length; singletons stay single elements.
 */

import { buildTemplate, auditCrossSvgDefs, EYE_CENTER_VARIANTS, EYE_HALO_VARIANTS } from '../src/template.js';
import { sanitizeConfig } from '../src/config.js';
import { AxidosAnimator } from '../src/animator.js';

let failures = 0;
let passed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log(`  PASS  ${msg}`); }
  else { failures++; console.error(`  FAIL  ${msg}`); }
};

const tpl = buildTemplate({ zoom: 85 });

// ---- Minimal DOM stubs for the animator (multi-copy shape) ----
function makeEl(id) {
  return {
    id,
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  };
}

function makeShadow() {
  const layers = ['backdrop', 'body', 'head', 'eye', 'led'].map((n) => makeEl(`axidos-svg-${n}`));
  const els = {
    'axidos-svg-backdrop': layers[0], 'axidos-svg-body': layers[1],
    'axidos-svg-head': layers[2], 'axidos-svg-eye': layers[3], 'axidos-svg-led': layers[4],
    hitbox: makeEl('hitbox'),
    'axidos-head': [makeEl('axidos-head-head'), makeEl('axidos-head-eye')],
    'head-bop': [makeEl('head-bop-head'), makeEl('head-bop-eye')],
    'torso-swivel': [makeEl('torso-swivel-body'), makeEl('torso-swivel-led')],
    'eye-layer-idle': makeEl('eye-layer-idle'), 'eye-layer-listen': makeEl('eye-layer-listen'),
    'eye-layer-process': makeEl('eye-layer-process'), 'eye-layer-respond': makeEl('eye-layer-respond'),
    'eye-layer-dance': makeEl('eye-layer-dance'),
    'eye-halo': makeEl('eye-halo'), 'eye-center': makeEl('eye-center'),
    'eye-pupil': makeEl('eye-pupil'), 'eyeball-assembly': makeEl('eyeball-assembly'),
    bellows: makeEl('bellows'), 'eye-lid': makeEl('eye-lid'), 'eye-lid-bottom': makeEl('eye-lid-bottom'),
    'danger-ring': makeEl('danger-ring'), 'progress-ring': makeEl('progress-ring'),
    'ind-l1': makeEl('ind-l1'), 'ind-l2': makeEl('ind-l2'),
    'ind-r1': makeEl('ind-r1'), 'ind-r2': makeEl('ind-r2'),
  };
  const centerVariants = EYE_CENTER_VARIANTS.map((c) => {
    const el = makeEl(`center-${c}`);
    el.setAttribute('data-color', c);
    return el;
  });
  const haloVariants = EYE_HALO_VARIANTS.map((f) => {
    const el = makeEl(`halo-${f}`);
    el.setAttribute('data-fill', f);
    return el;
  });
  return {
    els, centerVariants, haloVariants,
    getElementById: (id) => els[id] || null,
    querySelectorAll: (sel) => {
      if (sel === 'svg.axidos-layer') return layers;
      if (sel === '.led-matrix') return [];
      if (sel === '#axidos-head') return els['axidos-head'];
      if (sel === '#head-bop') return els['head-bop'];
      if (sel === '#torso-swivel') return els['torso-swivel'];
      if (sel === '.eye-center-variant') return centerVariants;
      if (sel === '.eye-halo-variant') return haloVariants;
      return [];
    },
  };
}

// ============================================================
console.log('\n== 1. Structure: 5 layers, z-order, hitbox, #scene guards ==');
{
  const layerIds = [...tpl.matchAll(/<svg id="(axidos-svg-[a-z]+)"/g)].map((m) => m[1]);
  assert(layerIds.length === 5, `exactly 5 stacked SVG layers (got ${layerIds.length})`);
  assert(
    JSON.stringify(layerIds) === JSON.stringify(['axidos-svg-backdrop', 'axidos-svg-body', 'axidos-svg-head', 'axidos-svg-eye', 'axidos-svg-led']),
    `layer order is backdrop → body → head → eye → led (${layerIds.join(', ')})`,
  );
  for (const [id, z] of [['axidos-svg-backdrop', 0], ['axidos-svg-body', 1], ['axidos-svg-head', 2], ['axidos-svg-eye', 3], ['axidos-svg-led', 4]]) {
    const re = new RegExp(`#${id}\\s*\\{\\s*z-index:\\s*${z};`);
    assert(re.test(tpl), `#${id} carries z-index: ${z}`);
  }
  assert(tpl.includes('#hitbox { position: absolute; inset: 0; z-index: 100;'), '#hitbox stays its own absolute layer, z-100, on top');
  assert(tpl.includes('#scene { position: relative;'), '#scene keeps position: relative (hitbox containing block)');
  assert(tpl.includes('contain: layout paint;'), '#scene keeps contain: layout paint');
  // Every layer: absolute positioning + overflow visible (pitfall 5a avoided
  // structurally — no tight layer boundary to clip against).
  assert(tpl.includes('svg.axidos-layer { position: absolute;'), 'layers are absolutely positioned in #scene');
  assert(tpl.includes('overflow: visible;'), 'layers keep overflow: visible (glow/shadow never clipped at a layer boundary)');
  // Hitbox nested inside #scene (the beta.2 soft-lock invariant).
  const idxScene = tpl.indexOf('<div id="scene"');
  const idxHitbox = tpl.indexOf('id="hitbox"');
  const idxSceneClose = tpl.lastIndexOf('</div>');
  assert(idxScene !== -1 && idxHitbox > idxScene && idxSceneClose > idxHitbox, '#hitbox is nested inside #scene');
}

// ============================================================
console.log('\n== 2. Identical viewBox on every layer ==');
{
  const viewboxes = [...tpl.matchAll(/<svg id="axidos-svg-[a-z]+"[^>]*viewBox="([^"]+)"/g)].map((m) => m[1]);
  assert(viewboxes.length === 5, `all 5 layers carry a viewBox (got ${viewboxes.length})`);
  assert(viewboxes.every((v) => v === '0 116 280 320'), `every layer viewBox is "0 116 280 320" (got ${[...new Set(viewboxes)].join(' | ')})`);
}

// ============================================================
console.log('\n== 3. Backdrop purity: defs host only, zero painted geometry ==');
{
  const backdrop = tpl.match(/<svg id="axidos-svg-backdrop"[\s\S]*?<\/svg>/);
  assert(backdrop !== null, 'backdrop layer found');
  const body = backdrop[0].replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').trim();
  assert(body.startsWith('<defs>') && body.endsWith('</defs>'), 'backdrop contains ONLY a <defs> block');
  // No painted shape elements outside defs (the defs content itself is
  // gradient/clipPath definitions — never rendered directly).
  const outsideDefs = body.replace(/^<defs>[\s\S]*<\/defs>$/, '').trim();
  assert(outsideDefs === '', 'no painted geometry outside the backdrop defs');
  // The defs must not contain rendered shapes (rect/circle/path/line/ellipse
  // as direct children — clipPath shapes are definitions, allowed).
  const defsContent = body.match(/<defs>([\s\S]*)<\/defs>/)[1];
  const shapeTags = [...defsContent.matchAll(/<(rect|circle|ellipse|path|line|polygon|polyline)\b(?![^>]*clip-path)/g)]
    .filter((m) => {
      // Only count shapes NOT inside a <clipPath> wrapper.
      const before = defsContent.slice(0, m.index);
      const opens = (before.match(/<clipPath\b/g) || []).length;
      const closes = (before.match(/<\/clipPath>/g) || []).length;
      return opens === closes;
    });
  assert(shapeTags.length === 0, `defs host carries no rendered shapes (got ${shapeTags.length})`);
}

// ============================================================
console.log('\n== 4. Mirror chains (C1/C2): duplicated pivots in the right layers ==');
{
  const layerOf = (id) => {
    const layers = [...tpl.matchAll(/<svg id="(axidos-svg-[a-z]+)"[\s\S]*?<\/svg>/g)];
    for (const l of layers) if (l[0].includes(`id="${id}"`)) return l[1];
    return null;
  };
  // JS-written pivots: primary + mirror.
  assert(layerOf('axidos-head') === 'axidos-svg-head', '#axidos-head primary lives in the head layer');
  assert(layerOf('head-bop') === 'axidos-svg-head', '#head-bop primary lives in the head layer');
  assert(layerOf('torso-swivel') === 'axidos-svg-body', '#torso-swivel primary lives in the body layer');
  // Count occurrences across ALL layers (duplicate ids are the mechanism).
  const countAcrossLayers = (id) => {
    const layers = [...tpl.matchAll(/<svg id="axidos-svg-[a-z]+"[\s\S]*?<\/svg>/g)];
    return layers.filter((l) => l[0].includes(`id="${id}"`)).length;
  };
  assert(countAcrossLayers('axidos-head') === 2, `#axidos-head exists in exactly 2 layers (head + eye mirror) (got ${countAcrossLayers('axidos-head')})`);
  assert(countAcrossLayers('head-bop') === 2, `#head-bop exists in exactly 2 layers (got ${countAcrossLayers('head-bop')})`);
  assert(countAcrossLayers('torso-swivel') === 2, `#torso-swivel exists in exactly 2 layers (body + LED mirror) (got ${countAcrossLayers('torso-swivel')})`);
  assert(countAcrossLayers('body-pivot') === 2, `#body-pivot exists in exactly 2 layers (got ${countAcrossLayers('body-pivot')})`);
  assert(countAcrossLayers('head-sway-pivot') === 2, `#head-sway-pivot exists in exactly 2 layers (got ${countAcrossLayers('head-sway-pivot')})`);
  // The eye layer carries the full head chain; the LED layer the full body chain.
  const eyeLayer = tpl.match(/<svg id="axidos-svg-eye"[\s\S]*?<\/svg>/)[0];
  const ledLayer = tpl.match(/<svg id="axidos-svg-led"[\s\S]*?<\/svg>/)[0];
  assert(eyeLayer.includes('id="axidos-head-wrapper"') && eyeLayer.includes('id="head-sway-pivot"') && eyeLayer.includes('id="axidos-head"') && eyeLayer.includes('id="head-bop"'),
    'eye layer mirrors the FULL head chain (wrapper → sway → head → bop)');
  assert(ledLayer.includes('id="body-pivot"') && ledLayer.includes('id="torso-swivel"') && ledLayer.includes('id="torso"'),
    'LED layer mirrors the FULL body chain (pivot → swivel → torso)');
  // Singletons stay singletons (no accidental duplication).
  for (const id of ['eyeball-assembly', 'eye-pupil', 'eye-lid', 'eye-lid-bottom', 'danger-ring', 'progress-ring', 'bellows']) {
    const n = [...tpl.matchAll(new RegExp(`id="${id}"`, 'g'))].length;
    assert(n === 1, `#${id} is a singleton (got ${n})`);
  }
}

// ============================================================
console.log('\n== 5. Mover CSS hygiene: no fill/color transitions in movers ==');
{
  // The style block must not transition fill/stroke on any mover element.
  const css = tpl.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert(!/transition:[^;]*\bfill\b/.test(css), 'no fill transitions in the layer CSS (variant stacks replaced them)');
  // #progress-ring's stroke/dasharray transitions are legitimate discrete
  // initiation events (sensor updates) — strip its rule before scanning.
  const cssNoRing = css.replace(/#progress-ring\s*\{[^}]*\}/, '');
  assert(!/transition:[^;]*\bstroke\b(?!-dasharray)/.test(cssNoRing.replace(/stroke-dasharray/g, 'strokeDasharray')), 'no stroke transitions outside the #progress-ring initiation rule');
  assert(/#progress-ring\s*\{[^}]*transition: stroke-dasharray/.test(css), '#progress-ring keeps its discrete dasharray/stroke initiation transitions');
  // Variant stacks carry the opacity transition instead.
  assert(css.includes('.eye-center-variant, .eye-halo-variant { transition: opacity 0.8s ease-in-out; }'), 'variant stacks crossfade via opacity (0.8s, matching the old fill ease)');
  // #eye-center keeps ONLY its transform pulse transition.
  assert(css.includes('#eye-center { transition: transform 0.18s ease-out; }'), '#eye-center keeps only the transform pulse transition');
  // will-change promotion kept on every animated group.
  for (const id of ['axidos-head', 'head-bop', 'torso-swivel', 'bellows', 'eyeball-assembly', 'eye-pupil', 'eye-lid', 'eye-lid-bottom', 'eye-center', 'body-pivot', 'head-sway-pivot']) {
    assert(css.includes(`#${id}`), `will-change promotion still lists #${id}`);
  }
  // LED layer is opacity-pure: the led CSS animates opacity only.
  assert(css.includes('.led-matrix.pulsing .led-dot { animation: led-pulse'), 'LED pulse is an opacity animation');
}

// ============================================================
console.log('\n== 6. Variant stacks: bounded sets, 1:1 with painted circles ==');
{
  assert(EYE_CENTER_VARIANTS.length === 8, `eye-center variant set bounded at 8 (got ${EYE_CENTER_VARIANTS.length})`);
  assert(EYE_HALO_VARIANTS.length === 8, `eye-halo variant set bounded at 8 (got ${EYE_HALO_VARIANTS.length})`);
  assert(EYE_CENTER_VARIANTS[EYE_CENTER_VARIANTS.length - 1] === 'dynamic', 'eye-center set ends with the dynamic fallback');
  assert(EYE_HALO_VARIANTS[EYE_HALO_VARIANTS.length - 1] === 'dynamic', 'eye-halo set ends with the dynamic fallback');
  // Painted circles match the sets 1:1.
  const centerCircles = [...tpl.matchAll(/class="eye-center-variant" data-color="([^"]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify(centerCircles) === JSON.stringify(EYE_CENTER_VARIANTS), 'painted #eye-center variants match the exported set exactly');
  const haloCircles = [...tpl.matchAll(/class="eye-halo-variant" data-fill="([^"]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify(haloCircles) === JSON.stringify(EYE_HALO_VARIANTS), 'painted #eye-halo variants match the exported set exactly');
  // Exactly one variant is active by default (idle) in each stack.
  const activeCenter = centerCircles.length - [...tpl.matchAll(/class="eye-center-variant"[^>]*opacity="0"/g)].length;
  assert(activeCenter === 1, `exactly one active eye-center variant at build (got ${activeCenter})`);
}

// ============================================================
console.log('\n== 7. A1 concurrent crossfade: same-frame in/out opacity writes ==');
{
  const shadow = makeShadow();
  const anim = new AxidosAnimator(shadow);
  // From the default idle (#ffcc00 active) to listening (#aaffff): ONE call
  // must write BOTH the incoming 0→1 and the outgoing 1→0.
  const byColor = (c) => shadow.centerVariants.find((v) => v.getAttribute('data-color') === c);
  anim.setEyeCenterColor('#aaffff');
  assert(byColor('#aaffff').style.opacity === '1', 'incoming variant opacity → 1');
  assert(byColor('#ffcc00').style.opacity === '0', 'outgoing variant opacity → 0 in the SAME call (concurrent, never sequential)');
  // Redundant-write guard.
  const before = JSON.stringify(shadow.centerVariants.map((v) => v.style.opacity));
  anim.setEyeCenterColor('#aaffff');
  assert(JSON.stringify(shadow.centerVariants.map((v) => v.style.opacity)) === before, 'identical color skips all writes');
  // Out-of-set value rides the dynamic fallback (fill written directly).
  anim.setEyeCenterColor('#123456');
  const dyn = byColor('dynamic');
  assert(dyn.attrs.fill === '#123456' && dyn.style.opacity === '1', 'out-of-set color rides the dynamic fallback (fill written, opacity 1)');
  assert(byColor('#aaffff').style.opacity === '0', 'previous variant fades out when the fallback activates');
  // Halo contract, same mechanics.
  anim.setEyeHaloFill('url(#haloGradDance)');
  const byFill = (f) => shadow.haloVariants.find((v) => v.getAttribute('data-fill') === f);
  assert(byFill('url(#haloGradDance)').style.opacity === '1' && byFill('url(#haloGradIdle)').style.opacity === '0',
    'halo crossfade is concurrent too (dance in, idle out, same call)');
}

// ============================================================
console.log('\n== 8. A3a write-parity: all pivot copies receive identical writes ==');
{
  const shadow = makeShadow();
  const anim = new AxidosAnimator(shadow);
  // Full sway+pose+bop cycle: every JS-written pivot group must receive the
  // SAME write on every copy (primary + mirror) — the layers stay registered.
  const cycle = [
    () => anim.setHead(12, 0, -5, 0.98, 1.4),
    () => anim.setHead(-6, 3, 15, 1.05, 1.2, 'linear'),
    () => anim.setBodySwivel(-2, 1, 1.8),
    () => anim.setBodySwivel(1, 0.98, 2.0),
    () => anim.resetBodySwivel(),
    () => anim.resetBopLayer(),
  ];
  for (const step of cycle) {
    step();
    for (const [name, els] of [['head', anim.el.head], ['headBop', anim.el.headBop], ['torsoSwivel', anim.el.torsoSwivel]]) {
      if (els.length < 2) continue;
      const first = JSON.stringify(els[0].style);
      const rest = els.slice(1).map((e) => JSON.stringify(e.style));
      assert(rest.every((s) => s === first), `all ${name} copies carry identical inline styles after the cycle step`);
    }
  }
  // freezeHeadMotion: each copy frozen from its OWN computed transform.
  let readCount = 0;
  globalThis.getComputedStyle = (el) => { readCount++; return { transform: `matrix(${readCount}, 0, 0, 1, 0, 0)` }; };
  anim.freezeHeadMotion();
  assert(anim.el.head[0].style.transform !== anim.el.head[1].style.transform,
    'freezeHeadMotion snapshots each copy from its OWN computed transform (not one shared value)');
  assert(anim.el.head.every((e) => e.style.transition === 'none'), 'all head copies frozen with transition: none');
  assert(anim.el.torsoSwivel.every((e) => e.style.transition === 'none'), 'all torso copies frozen with transition: none');
  delete globalThis.getComputedStyle;
}

// ============================================================
console.log('\n== 9. A3b cross-layer register: LED mirror chain == body chain ==');
{
  // Both layers must carry the IDENTICAL static transform chain
  // (#body-pivot > #torso-swivel > #torso matrix) — the LED dots and the
  // bezel frames track the same geometry from different layers.
  const chainRe = /<g id="body-pivot">\s*<g id="torso-swivel">\s*<g id="torso" transform="([^"]+)">/;
  const bodyChain = tpl.match(/<svg id="axidos-svg-body"[\s\S]*?<\/svg>/)[0].match(chainRe);
  const ledChain = tpl.match(/<svg id="axidos-svg-led"[\s\S]*?<\/svg>/)[0].match(chainRe);
  assert(bodyChain && ledChain, 'both body and LED layers carry the pivot chain');
  assert(bodyChain[1] === ledChain[1], `#torso matrix transform identical in both layers (${bodyChain[1]})`);
  // The LED layer's torso must contain ONLY the LED consumers (no painted
  // body artwork duplicated — that would double-paint).
  const ledTorso = tpl.match(/<svg id="axidos-svg-led"[\s\S]*?<\/svg>/)[0];
  assert(!ledTorso.includes('ceramicBackgroundGrad') && !ledTorso.includes('cx="60" cy="168"'),
    'LED mirror paints ONLY the LED consumers (no duplicated body artwork)');
  // And the consumers must be exactly the 6 elements.
  const ledIds = [...ledTorso.matchAll(/id="(led-matrix-[a-z]+|ind-[lr][12])"/g)].map((m) => m[1]);
  assert(ledIds.length === 6, `LED layer carries exactly the 6 consumers (got ${ledIds.length}: ${ledIds.join(', ')})`);
}

// ============================================================
console.log('\n== 10. A3c defs audit: all url(#…) resolve in the backdrop ==');
{
  const missing = auditCrossSvgDefs(tpl);
  assert(missing.length === 0, `live template: every url(#…) resolves in the backdrop defs host (missing: ${missing.join(', ') || 'none'})`);
  // A broken reference must trip the audit (the fallback must not fail
  // silently).
  const broken = tpl.replace('url(#glowGrad)', 'url(#doesNotExist)');
  const brokenMissing = auditCrossSvgDefs(broken);
  assert(brokenMissing.includes('doesNotExist'), 'a broken reference trips the audit (fallback can never fail silently)');
  // The backdrop defs host defines every referenced id.
  const backdrop = tpl.match(/<svg id="axidos-svg-backdrop"[\s\S]*?<\/svg>/)[0];
  const defined = new Set([...backdrop.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const refs = new Set([...tpl.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
  const unresolved = [...refs].filter((r) => !defined.has(r));
  assert(unresolved.length === 0, `all ${refs.size} referenced ids defined in the backdrop (${[...refs].slice(0, 4).join(', ')}…)`);
}

// ============================================================
console.log('\n== 11. dprfix retirement (A2) ==');
{
  // The wrapper is GONE from template.js.
  assert(!tpl.includes('dprFixStyles') && !tpl.includes('scale(dpr)'), 'dprFixStyles wrapper deleted — no scale codepath in any layer');
  // The key stays accepted for backward compatibility.
  assert(sanitizeConfig({ entity: 'x', debug_dprfix: true }).debug_dprfix === true, 'debug_dprfix key still accepted (backward compat)');
  assert(sanitizeConfig({ entity: 'x' }).debug_dprfix === false, 'debug_dprfix defaults OFF');
  // No layer carries a dprfix-style transform override.
  assert(!tpl.includes('transform-origin: 0 0'), 'no dprfix top-left pin injected into the template');
}

// ============================================================
console.log('\n== 12. Animator refs: layer lists + singletons ==');
{
  const shadow = makeShadow();
  const anim = new AxidosAnimator(shadow);
  assert(anim.el.svgs.length === 5, `el.svgs holds all 5 layer roots (got ${anim.el.svgs.length})`);
  assert(anim.el.head.length === 2, `el.head is the 2-copy list (got ${anim.el.head.length})`);
  assert(anim.el.headBop.length === 2, `el.headBop is the 2-copy list (got ${anim.el.headBop.length})`);
  assert(anim.el.torsoSwivel.length === 2, `el.torsoSwivel is the 2-copy list (got ${anim.el.torsoSwivel.length})`);
  assert(anim.el.hitbox && anim.el.hitbox.id === 'hitbox', 'el.hitbox stays a singleton');
  assert(anim.el.pupil && anim.el.pupil.id === 'eye-pupil', 'el.pupil stays a singleton (eye layer only)');
  assert(anim.el.dangerRing && anim.el.dangerRing.id === 'danger-ring', 'el.dangerRing stays a singleton (head layer only)');
  assert(anim.el.progressRing && anim.el.progressRing.id === 'progress-ring', 'el.progressRing stays a singleton (head layer only)');
  assert(anim._centerVariants.length === 8 && anim._haloVariants.length === 8, 'animator holds both variant stacks');
}

// ============================================================
console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('ALL CHECKS PASSED');