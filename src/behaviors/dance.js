/**
 * behaviors/dance.js — BPM-synced dance EXECUTION engine (phrase-driven,
 * CSS-transition execution).
 *
 * Choreography (what pose on which beat) lives in behaviors/choreography.js:
 * a DIRECT PORT of the legacy card's 32 hand-written blocks (8 per tier),
 * selected uniformly with no immediate repeat and gated by the energy
 * envelope. This module only EXECUTES that choreography.
 *
 * EXECUTION MODEL — declarative CSS transitions (the legacy card's model):
 * every beat computes its pose from the phrase engine and issues ONE
 * setHead() write (transition + transform). The browser compositor
 * interpolates the move even when the main thread janks, which is what kept
 * the legacy card smooth on Android WebView (Tab S6 Lite) at high BPM. There
 * is deliberately NO per-frame JS in the dance path.
 *
 *  - Phrase changes are HARD CUTS at the bar boundary (the legacy model):
 *    the cut itself reads as "new move". No establish ramp, no resolve
 *    pre-blend, no character crossfade — the next beat's CSS transition
 *    retargets from the head's CURRENT pose, which is snap-free by design.
 *  - Move styles map to easing + duration:
 *      · HIT moves: clamped at 2.0x beat — punch-and-recover textures (the
 *        legacy 0.1-beat downbeat snap vs 1.5-beat recover) survive intact;
 *        downbeats use an overshoot curve, offbeats a snappy ease-out.
 *      · FLOW moves: long duration (up to 1.9x beat) with ease-in-out —
 *        continuous travel; the next beat's transition retargets from the
 *        live pose with no snap.
 *  - Beat timing uses performance.now() drift correction so moves stay
 *    locked to the music.
 *  - Bop hold: while a tap bop owns the head (_danceHeld) the beat clock
 *    keeps ticking (phase stays synced) but every visual write is skipped;
 *    the first post-hold setHead() retargets from the frozen pose.
 *
 * Tracked resource names: 'dance-step', 'dance-led', 'dance-sync'.
 */

import {
  getEnergy, pickNextPhrase, phraseVariant, getBeatPose, hash32,
} from './choreography.js';

// Easing vocabulary (single-write move character):
//  - Downbeat HIT: overshoot curve — eases past the target then settles.
//  - Offbeat HIT: fast attack, soft landing.
//  - FLOW: plain ease-in-out glide.
// Exported for the verify script's easing-contract assertions.
export const DANCE_EASINGS = {
  hitDown: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  hitOff: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
  flow: 'cubic-bezier(0.42, 0, 0.58, 1)',
};
const HIT_DOWN_EASE = DANCE_EASINGS.hitDown;
const HIT_OFF_EASE = DANCE_EASINGS.hitOff;
const FLOW_EASE = DANCE_EASINGS.flow;

export function startDanceCycle(card, bpm) {
  const a = card.animator;
  stopDanceCycle(card);

  let dancePhase = 0;
  let currentBpm = Math.max(60, Math.min(200, bpm));
  let beatMs = (60 / currentBpm) * 1000;
  let beatSec = beatMs / 1000;
  let expectedNextTick = performance.now() + beatMs;

  const tierIdx = tierForBpm(currentBpm);
  const eyeHitScale = [1.06, 1.1, 1.18, 1.25][tierIdx];   // tier-scaled eye pulse

  // ---- In-place BPM retune (hysteresis against sensor jitter) ----
  // A same-tier BPM change retunes the beat clock WITHOUT resetting
  // dancePhase/phraseId/phraseCount — the choreography continues seamlessly
  // at the new tempo. Cross-tier changes return false: the phrase library
  // itself differs, so the caller must do a full restart.
  card._retuneDance = (newBpm) => {
    const nb = Math.max(60, Math.min(200, newBpm));
    if (tierForBpm(nb) !== tierIdx) return false;
    if (nb === currentBpm) return true;
    currentBpm = nb;
    beatMs = (60 / nb) * 1000;
    beatSec = beatMs / 1000;
    // Re-anchor the next tick from now: the beat INTERVAL changes, the
    // phase (dancePhase count) does not — no visual discontinuity.
    expectedNextTick = performance.now() + beatMs;
    return true;
  };

  // ---- Phrase driver state ----
  // The dance always opens on phrase 0 (the tier's base groove move), then
  // switches at every bar boundary (hard cut, legacy model).
  let phraseId = 0;
  let phraseCount = 0;
  let variant = phraseVariant(tierIdx, phraseId, phraseCount);

  // Redundant-write guards: the LED color never changes during a dance and
  // the halo/strobe only change on specific phrases/beats — skip identical
  // style writes.
  let lastLedOpacity = null;
  let lastHalo = null;
  let lastStrobeFill = null;

  const step = () => {
    if (card._state !== 'dancing') return;

    const executeTick = () => {
      dancePhase++;
      const now = performance.now();
      if (now > expectedNextTick + beatMs) { expectedNextTick = now; } else { expectedNextTick += beatMs; }
      const delay = Math.max(0, expectedNextTick - now);
      a.setTimeout('dance-step', step, delay);
    };

    // Bop hold: while a tap bop owns the head, the beat clock keeps ticking
    // (executeTick above) so phase stays synced to the music, but every
    // visual move is skipped. bop.js clears the flag at the meld point
    // (tap_bop_resume threshold) or on settle; the first post-hold setHead()
    // then retargets from the head's frozen pose with no snap.
    if (card._danceHeld) { executeTick(); return; }

    const b = dancePhase % 16; // beat within the phrase

    // Phrase rotation every 16 beats: HARD CUT into the next phrase (the
    // legacy model — the cut itself reads as "new move"). The next phrase is
    // picked HERE, at the switch, gated by the switch-time energy (no
    // lookahead): peak phrases only enter high-energy windows.
    if (b === 0 && dancePhase > 0) {
      phraseId = pickNextPhrase(tierIdx, phraseId, getEnergy(dancePhase), phraseCount);
      phraseCount++;
      variant = phraseVariant(tierIdx, phraseId, phraseCount);
    }

    const isDownBeat = b % 2 === 0;
    const move = getBeatPose(tierIdx, phraseId, b, variant, dancePhase);

    // LED/eye accents (redundant-write guarded — identical values are skipped).
    if (lastLedOpacity !== '1') { a.setLEDs('#1DB954', '1'); lastLedOpacity = '1'; }
    // Eye halo: peak phrases burn brighter (personality law).
    const halo = move.halo ? String(move.halo) : '0.5';
    if (lastHalo !== halo) { a.el.eyeHalo.style.opacity = halo; lastHalo = halo; }
    // Strobe (wildest tier-3 phrase): #eye-center fill toggles EVERY beat —
    // red on the downbeat, white on the off-beat (legacy red/white strobe).
    // Non-strobe phrases hold the dance default white.
    if (move.strobe) {
      const fill = isDownBeat ? '#ff0000' : '#ffffff';
      if (lastStrobeFill !== fill) { a.el.eyeCenter.setAttribute('fill', fill); lastStrobeFill = fill; }
    } else if (lastStrobeFill !== null && lastStrobeFill !== '#ffffff') {
      a.el.eyeCenter.setAttribute('fill', '#ffffff');
      lastStrobeFill = '#ffffff';
    }
    // Eye pulse: #eye-center carries a short CSS transform transition (see
    // template.js), so this write pulses the pupil organically instead of
    // snapping it open/closed every beat.
    a.el.eyeCenter.style.transform = `scale(${eyeHitScale})`;
    // Bellows pump: GRAVITY-COUPLED — the phrase compresses on the downbeat
    // dip and releases (0) on the rise.
    a.setBellows(move.pump, 0.12);
    a.setTimeout('dance-led', () => {
      if (card._state === 'dancing') {
        if (lastLedOpacity !== '0.15') { a.setLEDs('#1DB954', '0.15'); lastLedOpacity = '0.15'; }
        a.el.eyeHalo.style.opacity = '0.05';
        lastHalo = '0.05';
        a.el.eyeCenter.style.transform = 'scale(1)';
        a.setBellows(0, 0.3);
      }
    }, beatMs * 0.3);

    // Syncopation: half-beat "and" pupil accent for tier 1 only — at club/
    // hardcore tempos the pose hits already fill every beat, and an extra
    // half-beat timer per beat is main-thread work the tablet can't spare.
    // Seeded from the global beat counter (no Math.random in the dance loop).
    if (tierIdx === 1) {
      const sr = mulberryFrom(hash32(dancePhase + 1));
      a.setTimeout('dance-sync', () => {
        if (card._state !== 'dancing') return;
        a.setPupil((sr() - 0.5) * 4, (sr() - 0.5) * 3);
      }, beatMs * 0.5);
    }

    // Move-duration clamp: hit beats may run up to 2.0x beat (punch-and-
    // recover textures need the long recover), flow beats 1.9x. The next
    // beat's transition retargets from wherever the head is (CSS transitions
    // are snap-free by design).
    const maxBeats = move.flow ? FLOW_CLAMP_BEATS : HIT_CLAMP_BEATS;
    let moveDur = Math.min(move.durBeats * beatSec, beatSec * maxBeats);

    // THE move: one transition + one transform write. The compositor
    // interpolates off the main thread; retargeting mid-flight eases from
    // the head's CURRENT pose (no cancel, no snap, no style recalc).
    const ease = move.flow ? FLOW_EASE : (isDownBeat ? HIT_DOWN_EASE : HIT_OFF_EASE);
    a.setHead(move.r, move.tx, move.ty, move.s, moveDur, ease);

    // Pupil dart accent (seeded from the phrase engine, not Math.random).
    if (move.dart) a.setPupil(move.dart[0], move.dart[1]);

    // Body swivel (TORSO LAG law): half the head rotation over a LONG
    // ease-in-out sway (3 beats) — the torso lags behind the head like a
    // slow groove instead of twitching with every beat.
    a.setBodySwivel(move.r * -0.5, 1, beatSec * 3);

    // Chill lids (PERSONALITY law): the phrase supplies the lid attitude;
    // a relaxed floor keeps a whisper of droop so accents still read.
    const lid = Math.max(move.lid, currentBpm < 125 ? 0.15 : 0.08);
    a.setBaseLid(lid, beatSec * 0.5);
    executeTick();
  };

  step();
}

/** Tiny inline mulberry32 for the syncopation dart stream. */
function mulberryFrom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Duration clamps (in beats). HIT allows long recover beats (punch-and-
 *  recover textures: 0.1-beat snap vs 1.5-beat recover); FLOW glides cap at
 *  1.9x so a flow move always hands over before the phrase's second bar. */
const HIT_CLAMP_BEATS = 2.0;
const FLOW_CLAMP_BEATS = 1.9;

/** Tempo tier for a BPM value — the phrase-library selector. */
export function tierForBpm(bpm) {
  return bpm < 90 ? 0 : bpm < 125 ? 1 : bpm < 160 ? 2 : 3;
}

export function stopDanceCycle(card) {
  const a = card.animator;
  a.clearTimeout('dance-step');
  a.clearTimeout('dance-led');
  a.clearTimeout('dance-sync');
  delete card._retuneDance; // the in-place retune hook dies with the cycle
  // Reset the strobe fill so a dance ending mid-strobe doesn't leave the
  // pupil red (each state sets its own fill right after, but be explicit).
  if (a.el.eyeCenter) a.el.eyeCenter.setAttribute('fill', '#ffffff');
  // CSS transitions complete on their own — there is no WAAPI animation to
  // cancel and no fill:forwards snap. The head glides to its last target and
  // the next state's setHead() retargets it from there.
  a.setBellows(0, 0.3);
}