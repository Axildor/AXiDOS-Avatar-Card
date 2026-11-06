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
import {
  allowsConduit, allowsStrobe, strobeColorAt,
} from '../motion.js';

// Easing vocabulary (single-write move character) — 5.8.0 SERVO REWRITE.
//
// The pre-5.8.0 curves were HUMAN motion: `ease-in-out` and its near relatives
// accelerate out of rest and decelerate into the target. An actuator does the
// opposite — it drives hard from the first instant and then STOPS at the limit
// stop (with a small mechanical settle). These three curves are that
// vocabulary, and none of them is `ease-in-out`:
//
//  hitDown — actuator ramp into a damped settle: fast, near-linear drive with
//            a touch of overshoot past the stop, then back onto it. The
//            downbeat lands like a solenoid firing, not like a limb arriving.
//  hitOff  — hard-stop ramp: maximum drive authority, no cushion. Reads as
//            precision, not as a softened human offbeat.
//  flow    — linear actuation: constant-velocity travel along the rail. A
//            constant rate is exactly what a screw drive does; the previous
//            ease-in-out glide was the single most "organic" curve in the
//            dance.
//
// Exported for the verify script's easing-contract assertions, and pinned
// there against any future `ease-in-out` creeping back in.
export const DANCE_EASINGS = {
  hitDown: 'cubic-bezier(0.16, 0.94, 0.22, 1.02)',
  hitOff: 'cubic-bezier(0.08, 1, 0.18, 1)',
  flow: 'linear',
};

// Tempo-compensated duration beat (5.5.2): move durations scale with the
// beat, so at low BPM the fixed deg/px amplitudes crawl — at 70 BPM a
// 1.2-beat glide takes ~1.03 s for ~11 px of travel, which reads as slow
// motion. DUR_REF_BPM floors the DURATION beat at the reference tempo so
// travel velocity never drops below the reference speed. The beat CLOCK
// stays on the true BPM (poses still land on the music's beats); only
// moveDur and the tier 0/1 swivel duration use the compensated beat. At or
// above the reference tempo this is a no-op (min() picks beatSec).
export const DUR_REF_BPM = 110;
const HIT_DOWN_EASE = DANCE_EASINGS.hitDown;
const HIT_OFF_EASE = DANCE_EASINGS.hitOff;
const FLOW_EASE = DANCE_EASINGS.flow;

export function startDanceCycle(card, bpm, mood) {
  const a = card.animator;
  stopDanceCycle(card);

  // Motion policy (5.8.0). state.js resolves the mode (config + the OS
  // prefers-reduced-motion preference) once per state application and caches
  // it on the card, so the per-beat path only reads a string.
  const motionMode = card._motionMode || 'full';
  const flashSafe = card.config ? card.config.flash_safe !== false : true;
  const conduitOn = allowsConduit(motionMode);
  const strobeOn = allowsStrobe(motionMode);

  let dancePhase = 0;
  let currentBpm = Math.max(60, Math.min(200, bpm));
  let beatMs = (60 / currentBpm) * 1000;
  let beatSec = beatMs / 1000;
  // Duration beat: floored at the reference tempo so low-BPM moves keep
  // reference-tempo travel velocity (see DUR_REF_BPM above).
  let durBeatSec = Math.min(beatSec, 60 / DUR_REF_BPM);
  // Anchor at NOW, not now+beat: the first synchronous step() runs at t0 and
  // executeTick() advances the anchor by one beat — initializing at t0+beat
  // double-counted the first slot, so the second pose fired a full 2 beats
  // after the first (one skipped beat at every dance start).
  let expectedNextTick = performance.now();

  // Mood-aware style (5.6.0): the phrase LIBRARY tier is the BPM tier plus
  // the mood's tier shift, clamped to the valid range. The beat CLOCK stays
  // on the true BPM — poses still land on the music's beats; only the
  // movement vocabulary changes (a relaxed 130 BPM track dances chill moves
  // at 130 BPM tempo, not slowed-down grooving).
  const m = mood && mood.present ? mood : null;
  let energyBias = m ? m.energyBias : 0;
  let lidFloor = m && m.lidFloor !== null && m.lidFloor !== undefined ? m.lidFloor : null;
  const tierIdx = effectiveTierForBpm(currentBpm, m);
  const eyeHitScale = [1.08, 1.1, 1.18, 1.25][tierIdx];   // tier-scaled eye pulse

  // ---- In-place BPM/mood retune (hysteresis against sensor jitter) ----
  // A same-EFFECTIVE-tier change retunes the beat clock and mood directives
  // WITHOUT resetting dancePhase/phraseId/phraseCount — the choreography
  // continues seamlessly at the new tempo/style. A change that moves the
  // effective tier (BPM crossing a tier boundary, or a mood tier shift
  // flipping) returns false: the phrase library itself differs, so the
  // caller must do a full restart.
  card._retuneDance = (newBpm, newMood) => {
    const nb = Math.max(60, Math.min(200, newBpm));
    const nm = newMood && newMood.present ? newMood : null;
    if (effectiveTierForBpm(nb, nm) !== tierIdx) return false;
    if (nb === currentBpm && energyBias === (nm ? nm.energyBias : 0)
      && lidFloor === (nm && nm.lidFloor !== null && nm.lidFloor !== undefined ? nm.lidFloor : null)) return true;
    currentBpm = nb;
    beatMs = (60 / nb) * 1000;
    beatSec = beatMs / 1000;
    durBeatSec = Math.min(beatSec, 60 / DUR_REF_BPM);
    energyBias = nm ? nm.energyBias : 0;
    lidFloor = nm && nm.lidFloor !== null && nm.lidFloor !== undefined ? nm.lidFloor : null;
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
  // the halo/strobe/eye-pulse only change on specific phrases/beats — skip
  // identical style writes.
  let lastLedOpacity = null;
  let lastHalo = null;
  let lastStrobeFill = null;
  let lastEyeScale = null;
  // Body-swivel guard (tiers 0/1): the 3-beat sway is only re-issued when
  // the target rotation actually changes, so the transition completes its
  // travel instead of being interrupted at ~1/3 every beat (which forced a
  // synchronous transform read + retarget per beat).
  let lastSwivelRot = null;

  const step = () => {
    if (card._state !== 'dancing') return;

    const executeTick = () => {
      dancePhase++;
      const now = performance.now();
      // Beat-lateness probe (5.8.0): how late did THIS tick fire relative to
      // its scheduled slot? Positive = the main thread was busy and the pose
      // fired off-grid — the direct measurement behind the "skips a beat and
      // catches up" feel. Reported to the opt-in perf HUD only.
      if (card.perf && now > expectedNextTick) card.perf.recordBeatLateness(now - expectedNextTick);
      // Phase preservation (5.8.0): advance the grid in whole-beat steps
      // until it lies in the future. The old rule re-anchored the grid to
      // `now` when a timer fired more than one beat late — the pose grid
      // SHIFTED, the next pose fired instantly, and the choreography read as
      // "skips a beat and fast-forwards". With whole-beat advancement the
      // grid stays locked to the music's beat positions forever: a late tick
      // fires a late pose, and any fully-missed beats are simply skipped
      // without displacing the phase of the ones that follow.
      while (expectedNextTick <= now) expectedNextTick += beatMs;
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
      phraseId = pickNextPhrase(tierIdx, phraseId, getEnergy(dancePhase, energyBias), phraseCount);
      phraseCount++;
      variant = phraseVariant(tierIdx, phraseId, phraseCount);
    }

    const isDownBeat = b % 2 === 0;
    const move = getBeatPose(tierIdx, phraseId, b, variant, dancePhase);

    // LED/eye accents (redundant-write guarded — identical values are skipped).
    if (lastLedOpacity !== '1') { a.setLEDs('#1DB954', '1'); lastLedOpacity = '1'; }
    // LED telemetry (2.8, COST-GATED): ONE class toggle per beat drives a
    // compositor-animated CSS keyframe sweep. The class only changes at the
    // phrase boundary (scan for the groove phrases, burst for the peak
    // phrases), so the per-beat cost is a string comparison that misses.
    // See animator.setLedTelemetry for the measurement requirement.
    const telemetry = phraseTelemetry(move);
    // Guarded so a partial animator (older embedder, test stub) cannot break
    // the dance: telemetry is polish, never load-bearing.
    if (typeof a.setLedTelemetry === 'function') a.setLedTelemetry(telemetry);
    // Eye halo (2.7): FOLLOWS THE ENERGY ENVELOPE CONTINUOUSLY instead of
    // switching between two constants. The energy curve is already evaluated
    // for phrase selection, so this is one multiply and one guarded write per
    // beat — the same write count as before, with a continuous read instead
    // of a two-state flick. The phrase's own accent (halo) still raises the
    // floor, so a peak phrase burns brighter at the same energy.
    const energy = getEnergy(dancePhase, energyBias);
    const phraseFloor = move.halo ? move.halo : 0.5;
    const halo = Math.min(1, phraseFloor * (0.62 + 0.38 * Math.min(1, energy)))
      .toFixed(3);
    if (lastHalo !== halo) { a.el.eyeHalo.style.opacity = halo; lastHalo = halo; }
    // Strobe (wildest tier-3 phrase): red/white optic toggle. FLASH SAFETY
    // (3.13): the pre-5.8.0 code toggled on EVERY beat, which at 170 BPM is a
    // 2.83 Hz flash — above the 2 Hz budget. strobeColorAt() holds each colour
    // for an integer number of beats so the toggle interval is always
    // >= 0.5 s regardless of tempo; flash_safe:false restores the legacy
    // every-beat toggle for users who explicitly opt out. Reduced motion
    // suppresses the channel entirely (no strobe at all).
    if (strobeOn && move.strobe) {
      const fill = strobeColorAt(dancePhase, beatSec, flashSafe);
      if (lastStrobeFill !== fill) { a.setEyeCenterColor(fill); lastStrobeFill = fill; }
    } else if (lastStrobeFill !== null && lastStrobeFill !== '#ffffff') {
      a.setEyeCenterColor('#ffffff');
      lastStrobeFill = '#ffffff';
    }
    // Eye pulse: #eye-center carries a short CSS transform transition (see
    // template.js), so this write pulses the pupil organically instead of
    // snapping it open/closed every beat. Redundant-write guarded: the
    // scale value is constant within a dance, so after the first beat this
    // write (and its reset below) never fires again.
    const eyeScale = `scale(${eyeHitScale})`;
    if (lastEyeScale !== eyeScale) { a.el.eyeCenter.style.transform = eyeScale; lastEyeScale = eyeScale; }
    a.setTimeout('dance-led', () => {
      if (card._state === 'dancing') {
        if (lastLedOpacity !== '0.15') { a.setLEDs('#1DB954', '0.15'); lastLedOpacity = '0.15'; }
        // The halo decays to a floor rather than to a constant zero: with a
        // continuous energy-linked glow (2.7) the "dark" half of the beat
        // still has to read as a live optic, so the floor scales with energy.
        const floor = (0.02 + 0.06 * Math.min(1, getEnergy(dancePhase, energyBias))).toFixed(3);
        a.el.eyeHalo.style.opacity = floor;
        lastHalo = floor;
        if (lastEyeScale !== 'scale(1)') { a.el.eyeCenter.style.transform = 'scale(1)'; lastEyeScale = 'scale(1)'; }
      }
    }, beatMs * 0.3);

    // Syncopation: half-beat "and" pupil accent for tiers 0-1. At club/
    // hardcore tempos the pose hits already fill every beat, and an extra
    // half-beat timer per beat is main-thread work the tablet can't spare —
    // but at chill/groovy tempos the beat is long enough that the accent is
    // both affordable and needed (tier 0's glides otherwise read as static).
    // Seeded from the global beat counter (no Math.random in the dance loop).
    if (tierIdx <= 1) {
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
    let moveDur = Math.min(move.durBeats * durBeatSec, durBeatSec * maxBeats);

    // THE move: one transition + one transform write. The compositor
    // interpolates off the main thread; retargeting mid-flight eases from
    // the head's CURRENT pose (no cancel, no snap, no style recalc).
    const ease = move.flow ? FLOW_EASE : (isDownBeat ? HIT_DOWN_EASE : HIT_OFF_EASE);
    a.setHead(move.r, move.tx, move.ty, move.s, moveDur, ease);

    // Pupil dart accent (seeded from the phrase engine, not Math.random).
    // Gaze only — since 5.8.0 setPupil no longer touches the conduit.
    if (move.dart) a.setPupil(move.dart[0], move.dart[1]);

    // CONDUIT COMPRESSION (1.1 — the 5.5.1 removal, re-audited).
    //
    // The phrase engine has always returned `pump` (N px on the downbeat, 0 on
    // every offbeat: `c.isDown ? N : 0`). It was dropped from the execution
    // path in 5.5.1 "for performance" while the card still repainted its whole
    // SVG subtree per frame. Since the 5.7.0-beta.3 layer split that repaint
    // is gone, and the remaining cost is structurally identical to the
    // already-shipped setBaseLid() call below: one guarded style write per
    // beat on a `will-change: transform` group inside a clipped <g>.
    //
    // There is deliberately NO recovery timer. The offbeat write IS the
    // release: pump goes N → 0 on the very next beat, and the guard means the
    // repeated 0 writes cost nothing after the first. Adding a `dance-led`
    // style timer to "let it spring back" would re-add the second write per
    // beat that 5.5.1 was actually trying to remove.
    if (conduitOn) a.setBellows(move.pump, beatSec * 0.5);

    // Body swivel (TORSO LAG law): half the head rotation over a LONG
    // ease-in-out sway (3 beats) — the torso lags behind the head like a
    // slow groove instead of twitching with every beat.
    // Tier gate: at club/hardcore tempos a 3-beat swivel re-issued every
    // beat is always interrupted at ~1/3 travel, forcing a synchronous
    // transform read + retarget per beat (fps scales down with BPM on
    // Android tablets). Tier 2/3 use a duration that mostly settles within
    // one beat; tier 0/1 keep the slow follow-through but only re-issue the
    // write when the target rotation actually changes — the 3-beat sway
    // then completes its travel instead of being chopped every beat, and
    // the per-beat retarget cost disappears.
    const swivelRot = move.r * -0.5;
    if (tierIdx >= 2 || lastSwivelRot !== swivelRot) {
      // Tier 0/1 use the compensated duration beat: a 3-beat sway at 70 BPM
      // would otherwise take 2.57 s of absolute time (slow-motion torso).
      const swivelDur = tierIdx >= 2 ? beatSec * 1.15 : durBeatSec * 3;
      a.setBodySwivel(swivelRot, 1, swivelDur);
      lastSwivelRot = swivelRot;
    }

    // Chill lids (PERSONALITY law): the phrase supplies the lid attitude;
    // a floor keeps a whisper of droop so accents still read. See
    // resolveLidFloor for the mood-vs-BPM precedence rule.
    const bpmLidFloor = currentBpm < 125 ? 0.15 : 0.08;
    const lid = Math.max(move.lid, resolveLidFloor(bpmLidFloor, lidFloor));
    a.setBaseLid(lid, beatSec * 0.5);
    executeTick();
  };

  step();
}

/**
 * Which LED telemetry class a phrase drives (2.8). Phrase-level, not
 * beat-level: the class changes only at a phrase boundary, so the per-beat
 * cost is a compare that misses. `burst` is the peak-phrase read (the
 * indicator rack pulsing with the hits), `scan` the groove read (a slow
 * travelling sweep). Null = the resting default.
 */
function phraseTelemetry(move) {
  if (move.strobe) return 'burst';
  if (move.halo !== undefined && move.halo !== null && Number(move.halo) >= 0.8) return 'burst';
  return 'scan';
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

/**
 * Resolve the dance lid-droop floor from the BPM-only floor and the optional
 * mood floor (5.7.2).
 *
 * When a mood is present its floor is AUTHORITATIVE — it REPLACES the
 * BPM-only floor instead of being maxed with it. This is deliberate:
 *
 *  - Under the old `Math.max(bpmFloor, moodFloor)` rule the high-arousal
 *    floor (0.05) could never beat either BPM floor (0.15 at <125 BPM, 0.08
 *    at >=125 BPM), so every "party/aggressive = wide awake" directive was
 *    dead code — the mood only ever raised the floor, never lowered it.
 *  - With replacement, calm heads still raise the droop (relaxed 0.3,
 *    acoustic 0.22) and high-arousal heads genuinely clear the way for the
 *    phrase's own lid attitude (aggressive/party 0.05, electronic 0.08).
 *
 * moodFloor === null / undefined (no mood, or a head that publishes no
 * floor) keeps the legacy BPM-only behaviour bit-identically.
 *
 * Exported for the verify suite: this precedence rule is exactly the kind
 * of invariant that a future "simplification" would silently invert.
 */
export function resolveLidFloor(bpmLidFloor, moodFloor) {
  if (moodFloor === null || moodFloor === undefined) return bpmLidFloor;
  return moodFloor;
}

/** Tempo tier for a BPM value — the phrase-library selector. */
export function tierForBpm(bpm) {
  return bpm < 90 ? 0 : bpm < 125 ? 1 : bpm < 160 ? 2 : 3;
}

/** Effective phrase-library tier: the BPM tier shifted by the mood's tier
 *  shift (relaxed −1, party/aggressive +1), clamped to [0, 3]. The mood
 *  argument is optional/absent-safe — a plain BPM sensor yields the legacy
 *  tierForBpm result. */
export function effectiveTierForBpm(bpm, mood) {
  const shift = mood && mood.present ? mood.tierShift : 0;
  return Math.min(3, Math.max(0, tierForBpm(bpm) + shift));
}

export function stopDanceCycle(card) {
  const a = card.animator;
  a.clearTimeout('dance-step');
  a.clearTimeout('dance-led');
  a.clearTimeout('dance-sync');
  delete card._retuneDance; // the in-place retune hook dies with the cycle
  // Reset the strobe fill so a dance ending mid-strobe doesn't leave the
  // pupil red (each state sets its own fill right after, but be explicit).
  // Layer split: variant-stack crossfade, not a fill write.
  if (a.el.eyeCenter) a.setEyeCenterColor('#ffffff');
  // LED telemetry (2.8): the sweep class must not outlive the dance — the
  // idle/processing indicator semantics are set by states.js and a stale
  // telemetry class would keep animating the rack in a still state.
  if (typeof a.setLedTelemetry === 'function') a.setLedTelemetry(null);
  // CSS transitions complete on their own — there is no WAAPI animation to
  // cancel and no fill:forwards snap. The head glides to its last target and
  // the next state's setHead() retargets it from there.
  //
  // Release the conduit (1.1): the dance is the only writer of #bellows, so
  // leaving it compressed would strand the flex column mid-travel until the
  // next dance. This is a TEARDOWN write, not a per-beat recovery timer —
  // exactly the distinction 5.5.1's "recovery timer" removal failed to make.
  a.setBellows(0, 0.3);
}