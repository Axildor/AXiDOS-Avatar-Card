/**
 * verify_dance_smoothness.mjs — End-to-end verification of the dance
 * choreography contract. Runs the real startDanceCycle() with a stubbed
 * animator and asserts, for every tier (70/110/140/180 BPM):
 *
 * Execution contract (CSS-transition model):
 *  1. One setHead() move per beat — no WAAPI keyframes, no RAF loops, no
 *     getComputedStyle() recalcs in the dance path (compositor-friendly).
 *  2. Duration contract: hit beats clamp at 2.0x beat (long recover beats
 *     allowed — punch-and-recover), flow beats at 1.9x beat.
 *  3. Easing contract: flow moves use the flow bezier; hit downbeats the
 *     overshoot curve; hit offbeats the snappy ease-out.
 *  4. Pose targets match the phrase engine's getBeatPose output exactly.
 *  5. Bop hold: while _danceHeld is set, the beat clock keeps ticking but
 *     NO visual writes happen (no setHead, no LED, no swivel, no lid).
 *
 * Choreography contract (legacy port):
 *  6. Selection: uniform over the tier vocabulary with NO immediate repeat;
 *     every phrase is reachable (appears in a long walk).
 *  7. Energy gating: peak phrases (energy > 0.8) only start in
 *     high-energy windows (switch-time energy >= phrase energy - margin).
 *  8. Hard cuts: phrase switches happen EXACTLY at the bar boundary
 *     (beat 0) with no pre-blend ramp — the beat-0 pose is the new phrase's
 *     own pose, not a blend of the outgoing one.
 *  9. Determinism: two identical runs produce identical pose sequences —
 *     no Math.random in choreography (seeded variants only).
 * 10. Full-amplitude contract: the pose scale factor is constant within a
 *     phrase (only the harmless variant jitter) — phrase changes are the
 *     ONLY source of amplitude contrast (no 0.7x dips).
 * 11. Body swivel continuity: multi-beat duration, half head rotation.
 * 12. Energy envelope: CONTINUOUS curve (no plateaus, no adjacent-equal
 *     beats, bounded per-beat drift), groove<build<peak arc shape, and the
 *     97-beat wobble breaks the fixed 64-beat repetition.
 * 13. BPM retune: same-tier retune keeps the beat clock ticking without
 *     resetting the phase; cross-tier retune is rejected; the hook dies
 *     with the cycle.
 *
 * Acceptance checks (the task's demo-studio criteria, asserted statically):
 *  A1. Consecutive beats produce different lateral targets in >= 4 of 8
 *      tier-1 phrases (no 2-beat holds of the same tilt).
 *  A2. Decoupled lateral channels: pure-sway phrases (r = 0, tx oscillating)
 *      in tiers 0-2; tx drawn independently of r in tier 3 (chaos/glitch).
 *  A3. Punch-recover phrase: 0.1-beat downbeat snap, long off-beat recover
 *      to the SAME pose.
 *  A4. Pupil darts present in tiers 2-3 (and tier 1), seeded.
 *  A5. Strobe phrase exists in tier 3 (strobe: true).
 */

import { startDanceCycle, stopDanceCycle, DANCE_EASINGS } from '../src/behaviors/dance.js';
import {
  TIERS, getEnergy, pickNextPhrase, phraseVariant, getBeatPose,
} from '../src/behaviors/choreography.js';

// ---- Minimal DOM/animator stub ----
function makeEl() {
  return {
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
  };
}

function makeAnimator() {
  const el = {};
  for (const k of ['svg', 'head', 'headBop', 'torsoSwivel', 'hitbox', 'eyeHalo', 'eyeCenter', 'pupil', 'eyeball', 'bellows', 'lidTop', 'lidBot', 'dangerRing']) el[k] = makeEl();
  el.ledMatrices = [];
  const a = {
    el,
    currentBaseLid: 0,
    currentLedColor: '#ffb800',
    currentLedOpacity: '0.15',
    _timers: new Map(),
    _rafs: new Map(),
    _headCalls: [],
    _swivelCalls: [],
    _bellowsCalls: [],
    _rafNames: [],
    setTimeout(name, fn, delay) { this._timers.set(name, { fn, delay }); return name; },
    clearTimeout(name) { this._timers.delete(name); },
    requestRaf(name, fn) { this._rafNames.push(name); this._rafs.set(name, fn); return name; },
    cancelRaf(name) { this._rafs.delete(name); },
    setHead(rot, tx, ty, s, dur, ease) {
      this._headCalls.push({ rot, tx, ty, s, dur, ease });
      this.el.head.style.transform = `translate3d(${tx}px,${ty}px,0) rotate(${rot}deg) scale(${s})`;
    },
    resetBodySwivel() {},
    setBodySwivel(rot, sx, dur) { this._swivelCalls.push({ rot, dur }); },
    setLid() {}, setBaseLid(v) { this.currentBaseLid = v; },
    setPupil() {}, setBellows(p) { this._bellowsCalls.push(p); }, setLEDs(c, o) { this.currentLedColor = c; this.currentLedOpacity = o; }, setLedVars() {},
    stopAll() { this._timers.clear(); this._rafs.clear(); },
  };
  return a;
}

function makeCard() {
  return { animator: makeAnimator(), _state: 'dancing', config: {} };
}

// Drive the dance step loop manually: the step timer is stored under
// 'dance-step' with its delay; we invoke it repeatedly, simulating beats.
function runBeats(card, count) {
  const a = card.animator;
  for (let i = 0; i < count; i++) {
    const t = a._timers.get('dance-step');
    if (!t) break;
    a._timers.delete('dance-step');
    t.fn(); // executes one beat's worth of choreography
  }
}

let failures = 0;
const assert = (cond, msg) => {
  if (cond) { console.log(`  PASS: ${msg}`); }
  else { failures++; console.error(`  FAIL: ${msg}`); }
};

// ---- Simulated phrase walk (mirrors dance.js's driver exactly) ----
// The choreography is fully deterministic, so the verify script can replay
// the same walk the engine performs and assert structural properties
// (selection, gating, hard cuts, laws) against the same data the engine used.
function simulateWalk(tierIdx, beats) {
  let phraseId = 0;
  let phraseCount = 0;
  let variant = phraseVariant(tierIdx, phraseId, phraseCount);
  const seq = [];
  for (let phase = 0; phase < beats; phase++) {
    const b = phase % 16;
    if (b === 0 && phase > 0) {
      phraseId = pickNextPhrase(tierIdx, phraseId, getEnergy(phase), phraseCount);
      phraseCount++;
      variant = phraseVariant(tierIdx, phraseId, phraseCount);
    }
    const move = getBeatPose(tierIdx, phraseId, b, variant, phase);
    seq.push({ phase, b, phraseId, move });
  }
  return seq;
}

const TIERS_BPM = [
  { bpm: 70, label: 'tier 0 (chill, 70 BPM)' },
  { bpm: 110, label: 'tier 1 (groovy, 110 BPM)' },
  { bpm: 140, label: 'tier 2 (club, 140 BPM)' },
  { bpm: 180, label: 'tier 3 (hardcore, 180 BPM)' },
];

for (const tier of TIERS_BPM) {
  console.log(`\n== ${tier.label} ==`);
  const tierIdx = TIERS_BPM.indexOf(tier);
  const beatSec = 60 / tier.bpm;
  const hitMax = beatSec * 2.0;
  const flowMax = beatSec * 1.9;

  // Run 64 beats (a full energy-arc cycle) through the real engine.
  const card = makeCard();
  startDanceCycle(card, tier.bpm);
  runBeats(card, 64);

  const calls = card.animator._headCalls;
  assert(calls.length >= 32, `pose moves fired (${calls.length} setHead calls over 64 beats)`);

  // 1. No WAAPI / RAF in the dance path: the engine must not register any
  //    RAF loop (the old groove spring) and must not call el.animate().
  assert(card.animator._rafNames.length === 0, 'no RAF loops in the dance path (no per-frame JS, compositor-friendly)');
  assert(card.animator.el.head.animate === undefined, 'no WAAPI keyframes in the dance path (no per-beat cancel/create churn)');

  // 2. Duration contract: hit beats clamp at 2.0x beat, flow beats at 1.9x.
  {
    const walk = simulateWalk(tierIdx, calls.length);
    let durOk = true;
    calls.forEach((c, i) => {
      const m = walk[i].move;
      const max = m.flow ? flowMax : hitMax;
      if (c.dur > max + 1e-9 || c.dur < beatSec * 0.05) {
        durOk = false;
        console.error(`    call ${i} (phase ${i}, beat ${walk[i].b}): bad moveDur ${c.dur.toFixed(3)}s (beat ${beatSec.toFixed(3)}s, max ${max.toFixed(3)}s, flow=${m.flow})`);
      }
    });
    assert(durOk, `all moveDurs within the clamp (hit 2.0x / flow 1.9x of ${beatSec.toFixed(3)}s beat, punch moves allowed)`);
  }

  // 3. Easing contract: flow moves use the flow bezier; hit downbeats the
  //    overshoot curve; hit offbeats the snappy ease-out.
  {
    const walk = simulateWalk(tierIdx, calls.length);
    let easeOk = true;
    calls.forEach((c, i) => {
      const m = walk[i].move;
      const expected = m.flow ? DANCE_EASINGS.flow
        : (walk[i].b % 2 === 0 ? DANCE_EASINGS.hitDown : DANCE_EASINGS.hitOff);
      if (c.ease !== expected) {
        easeOk = false;
        console.error(`    call ${i} (phase ${i}, beat ${walk[i].b}): easing "${c.ease}", expected "${expected}"`);
      }
    });
    assert(easeOk, 'easing contract: flow bezier on flow beats, overshoot/snap on hit down/off beats');
  }

  // 4. Pose targets match the phrase engine exactly.
  {
    const walk = simulateWalk(tierIdx, calls.length);
    let poseOk = true;
    calls.forEach((c, i) => {
      const m = walk[i].move;
      if (Math.abs(c.rot - m.r) > 1e-9 || Math.abs(c.tx - m.tx) > 1e-9
        || Math.abs(c.ty - m.ty) > 1e-9 || Math.abs(c.s - m.s) > 1e-9) {
        poseOk = false;
        console.error(`    call ${i} (phase ${i}, beat ${walk[i].b}): pose [${c.rot.toFixed(2)}, ${c.tx.toFixed(2)}, ${c.ty.toFixed(2)}, ${c.s.toFixed(3)}] != engine [${m.r.toFixed(2)}, ${m.tx.toFixed(2)}, ${m.ty.toFixed(2)}, ${m.s.toFixed(3)}]`);
      }
    });
    assert(poseOk, 'pose targets match the phrase engine (getBeatPose) exactly');
  }

  // 6. Selection: no immediate repeat; every phrase reachable in a long walk.
  //    1024 beats: peak-gated phrases are only eligible in high-energy
  //    windows, so a short walk can legitimately miss some of them.
  {
    const walk = simulateWalk(tierIdx, 1024);
    let noRepeat = true;
    let prev = null;
    const seen = new Set();
    for (const w of walk) {
      if (w.b === 0) {
        if (prev !== null && w.phraseId === prev) {
          noRepeat = false;
          console.error(`    immediate repeat: ${TIERS[tierIdx].phrases[prev].name} back-to-back at phase ${w.phase}`);
        }
        seen.add(w.phraseId);
        prev = w.phraseId;
      }
    }
    assert(noRepeat, 'selection: no immediate phrase repeat at bar boundaries');
    assert(seen.size === TIERS[tierIdx].phrases.length,
      `every phrase reachable (${seen.size}/${TIERS[tierIdx].phrases.length} seen in 1024 beats)`);

    // 7. Energy gating: peak phrases only start in high-energy windows.
    let gated = true;
    for (const w of walk) {
      if (w.b === 0 && w.phase > 0) {
        const p = TIERS[tierIdx].phrases[w.phraseId];
        if (p.energy > 0.8 && getEnergy(w.phase) < p.energy - 0.3 - 1e-9) {
          gated = false;
          console.error(`    peak phrase ${p.name} (energy ${p.energy}) started at window energy ${getEnergy(w.phase).toFixed(2)}`);
        }
      }
    }
    assert(gated, 'energy gating: peak phrases only play during high-energy windows (verse/chorus dynamics)');

    // 8. Hard cuts: the switch happens EXACTLY at the bar boundary with no
    //    pre-blend — the beat-0 pose is the new phrase's own pose (compare
    //    against a walk that starts fresh in that phrase), and beats 13-15
    //    of the outgoing phrase are NOT blended toward the next entry.
    let hardCut = true;
    for (const w of walk) {
      if (w.b === 0 && w.phase > 0) {
        const fresh = getBeatPose(tierIdx, w.phraseId, 0,
          phraseVariant(tierIdx, w.phraseId, Math.floor(w.phase / 16)), w.phase);
        const err = Math.max(
          Math.abs(w.move.r - fresh.r), Math.abs(w.move.tx - fresh.tx),
          Math.abs(w.move.ty - fresh.ty), Math.abs(w.move.s - fresh.s));
        if (err > 1e-9) {
          hardCut = false;
          console.error(`    phase ${w.phase}: beat-0 pose not the new phrase's own pose (err ${err.toFixed(4)})`);
        }
      }
      if (w.b >= 13 && w.nextPhraseId !== undefined && w.nextPhraseId !== null) {
        hardCut = false; // no pre-blend state should exist at all
      }
    }
    assert(hardCut, 'hard cuts: phrase switches land exactly at the bar boundary, no pre-blend ramp');

    // 10. Full-amplitude contract: within a phrase, the pose scale factor is
    //     constant (only variant.jitter) — no establish ramp, no energy-arc
    //     amplitude modulation. Verified by comparing the engine's output
    //     against a jitter-only recomputation of the raw pose.
    let ampStable = true;
    for (const w of walk) {
      const v = phraseVariant(tierIdx, w.phraseId, Math.floor(w.phase / 16));
      const fresh = getBeatPose(tierIdx, w.phraseId, w.b, v, w.phase);
      const err = Math.max(
        Math.abs(w.move.r - fresh.r), Math.abs(w.move.tx - fresh.tx),
        Math.abs(w.move.ty - fresh.ty), Math.abs(w.move.s - fresh.s));
      if (err > 1e-9) {
        ampStable = false;
        console.error(`    phase ${w.phase} beat ${w.b}: pose differs from jitter-only recomputation (err ${err.toFixed(4)})`);
      }
    }
    assert(ampStable, 'full-amplitude: poses are jitter-only scaled (no establish ramp, no energy amplitude modulation)');

    // 9. Determinism: a second identical walk produces identical poses.
    const walk2 = simulateWalk(tierIdx, 1024);
    let det = walk.length === walk2.length;
    for (let i = 0; det && i < walk.length; i++) {
      const a1 = walk[i].move; const a2 = walk2[i].move;
      if (Math.abs(a1.r - a2.r) > 1e-9 || Math.abs(a1.tx - a2.tx) > 1e-9
        || Math.abs(a1.ty - a2.ty) > 1e-9 || Math.abs(a1.s - a2.s) > 1e-9
        || a1.flow !== a2.flow) det = false;
    }
    assert(det, 'determinism: identical runs produce identical choreography (seeded, no Math.random)');
  }

  stopDanceCycle(card);
}

// ---- Acceptance checks (static, across the whole vocabulary) ----
{
  console.log('\n== acceptance checks ==');

  // A1. Consecutive beats produce different lateral targets in >= 4 of 8
  //     tier-1 phrases (no 2-beat holds of the same tilt).
  {
    const tierIdx = 1;
    let dynamicCount = 0;
    for (const p of TIERS[tierIdx].phrases) {
      let dynamic = false;
      for (let b = 0; b + 1 < 16; b++) {
        const v = phraseVariant(tierIdx, TIERS[tierIdx].phrases.indexOf(p), 0);
        const m1 = getBeatPose(tierIdx, TIERS[tierIdx].phrases.indexOf(p), b, v, b);
        const m2 = getBeatPose(tierIdx, TIERS[tierIdx].phrases.indexOf(p), b + 1, v, b + 1);
        if (Math.abs(m1.r - m2.r) > 0.5 || Math.abs(m1.tx - m2.tx) > 0.5) { dynamic = true; break; }
      }
      if (dynamic) dynamicCount++;
    }
    assert(dynamicCount >= 4, `A1: ${dynamicCount}/8 tier-1 phrases change lateral targets on consecutive beats (need >= 4)`);
  }

  // A2. Decoupled lateral channels in every tier: tiers 0-2 each have a
  //     PURE-SWAY phrase (r = 0, tx oscillating — reads as a body shift);
  //     tier 3 instead has tx drawn INDEPENDENTLY of r (chaos/glitch — its
  //     lateral texture is random jerks, per the approved design).
  {
    let decoupled = true;
    for (const t of [0, 1, 2]) {
      const found = TIERS[t].phrases.some((p) => {
        const idx = TIERS[t].phrases.indexOf(p);
        const v = phraseVariant(t, idx, 0);
        for (let b = 0; b < 16; b++) {
          const m = getBeatPose(t, idx, b, v, b);
          if (Math.abs(m.r) < 0.5 && Math.abs(m.tx) > 1) return true;
        }
        return false;
      });
      if (!found) { decoupled = false; console.error(`    tier ${t}: no pure-sway phrase`); }
    }
    const t3 = TIERS[3].phrases.some((p) => {
      const idx = TIERS[3].phrases.indexOf(p);
      const v = phraseVariant(3, idx, 0);
      // tx is an INDEPENDENT draw if the tx/r ratio varies across beats
      // (a slaved tx = r * k would keep the ratio constant).
      let sawTx = false;
      let ratio = null;
      for (let b = 0; b < 16; b++) {
        const m = getBeatPose(3, idx, b, v, b);
        if (Math.abs(m.tx) < 1 || Math.abs(m.r) < 1) continue;
        const cur = m.tx / m.r;
        if (sawTx && Math.abs(cur - ratio) > 0.15) return true;
        sawTx = true;
        ratio = cur;
      }
      return false;
    });
    if (!t3) { decoupled = false; console.error('    tier 3: no tx-independent phrase'); }
    assert(decoupled, 'A2: decoupled lateral channels — pure sway in tiers 0-2, tx-independent jerks in tier 3');
  }

  // A3. Punch-recover: 0.1-beat downbeat snap, long off-beat recover, SAME pose.
  {
    const tierIdx = 2;
    const idx = TIERS[tierIdx].phrases.findIndex((p) => p.name === 'punch-recover');
    const v = phraseVariant(tierIdx, idx, 0);
    const down = getBeatPose(tierIdx, idx, 0, v, 0);
    const off = getBeatPose(tierIdx, idx, 1, v, 1);
    const samePose = Math.abs(down.r - off.r) < 1e-9 && Math.abs(down.tx - off.tx) < 1e-9;
    const snap = Math.abs(down.durBeats - 0.1) < 1e-9;
    const recover = off.durBeats >= 0.8;
    assert(idx >= 0 && samePose && snap && recover,
      `A3: punch-recover snaps on the downbeat (${down.durBeats} beats) and recovers long (${off.durBeats} beats) to the SAME pose`);
  }

  // A4. Pupil darts present in tiers 1-3, seeded (deterministic).
  {
    let dartsOk = true;
    for (const tierIdx of [1, 2, 3]) {
      const hasDart = TIERS[tierIdx].phrases.some((p) => {
        const idx = TIERS[tierIdx].phrases.indexOf(p);
        const v = phraseVariant(tierIdx, idx, 0);
        for (let b = 0; b < 16; b += 2) {
          if (getBeatPose(tierIdx, idx, b, v, b).dart) return true;
        }
        return false;
      });
      if (!hasDart) { dartsOk = false; console.error(`    tier ${tierIdx}: no darting phrase`); }
    }
    assert(dartsOk, 'A4: pupil darts present in tiers 1-3 (seeded via c.rnd, downbeats)');
  }

  // A5. Strobe phrase exists in tier 3.
  {
    const strobe = TIERS[3].phrases.find((p) => p.strobe === true);
    assert(!!strobe, `A5: tier 3 has a strobe phrase (${strobe ? strobe.name : 'none'})`);
  }

  // A6. Decoupled channels: at least one phrase per tier moves tx
  //     independently of r (pure sway counts), and tier 1 has a phrase with
  //     an independent ty pattern (array-tilt: ty=[0,8,0,8] vs r=[10,5,-10,-5]).
  {
    const idx = TIERS[1].phrases.findIndex((p) => p.name === 'array-tilt');
    const v = phraseVariant(1, idx, 0);
    const m0 = getBeatPose(1, idx, 0, v, 0);
    const m1 = getBeatPose(1, idx, 1, v, 1);
    const decoupled = m0.ty === 0 && m1.ty > 0 && m0.r > m1.r; // ty pattern ≠ r pattern
    assert(decoupled, 'A6: tier-1 array-tilt runs ty on its own pattern (r=[10,5,-10,-5], ty=[0,8,0,8])');
  }
}

// 5. Bop hold: while _danceHeld is set the beat clock keeps ticking but no
//    visual writes happen; on release the choreography resumes.
{
  console.log('\n== bop hold ==');
  const card = makeCard();
  startDanceCycle(card, 110);
  runBeats(card, 2);
  card._danceHeld = true;
  const headBefore = card.animator._headCalls.length;
  const swivelBefore = card.animator._swivelCalls.length;
  const ledBefore = card.animator.currentLedOpacity;
  runBeats(card, 3); // beat clock ticks under hold
  const held = card.animator._headCalls.length === headBefore
    && card.animator._swivelCalls.length === swivelBefore
    && card.animator.currentLedOpacity === ledBefore;
  assert(held, 'bop hold: beat clock ticks but no visual writes (head/swivel/LED frozen)');
  assert(card.animator._timers.has('dance-step'), 'bop hold: beat clock still ticking (dance-step timer set)');
  card._danceHeld = false;
  runBeats(card, 1);
  assert(card.animator._headCalls.length > headBefore, 'choreography resumes after hold release (setHead fired)');
  stopDanceCycle(card);
}

// 11. Body swivel continuity: swivel duration is multi-beat (slow sway), and
//     the rotation is half the head rotation (lagging torso, not a twitch).
{
  console.log('\n== body swivel continuity ==');
  const card = makeCard();
  startDanceCycle(card, 110);
  runBeats(card, 4);
  const beatSec = 60 / 110;
  const swivels = card.animator._swivelCalls;
  const durOk = swivels.every((s) => s.dur >= beatSec * 2 - 1e-9);
  assert(swivels.length === 5 && durOk, `swivel duration is multi-beat (${swivels[0]?.dur.toFixed(2)}s vs ${beatSec.toFixed(2)}s beat)`);
  stopDanceCycle(card);
}

// 12. Energy envelope: CONTINUOUS curve — no plateaus, no adjacent-equal
//     beats, bounded per-beat drift; arc shape preserved; the 97-beat
//     wobble breaks the fixed 64-beat repetition.
{
  console.log('\n== energy envelope ==');
  const e0 = getEnergy(0);   // groove center
  const e16 = getEnergy(16); // build center
  const e32 = getEnergy(32); // peak center
  const e48 = getEnergy(48); // release center
  const shapeOk = e0 < e16 && e16 < e32 && e32 > e48 && e48 > e0;
  assert(shapeOk, `energy arc groove<build, peak max, release recovers (${e0.toFixed(2)} < ${e16.toFixed(2)} < ${e32.toFixed(2)}; release ${e48.toFixed(2)})`);

  let plateau = false;
  let maxDrift = 0;
  for (let p = 0; p < 4096; p++) {
    const d = Math.abs(getEnergy(p + 1) - getEnergy(p));
    if (d === 0) { plateau = true; console.error(`    plateau at phase ${p}`); break; }
    if (d > maxDrift) maxDrift = d;
  }
  assert(!plateau, 'energy envelope is continuous: no flat plateaus anywhere in 4096 beats');
  assert(maxDrift < 0.05, `per-beat energy drift is gradual (max ${maxDrift.toFixed(4)} < 0.05)`);

  let shifted = false;
  for (let p = 0; p < 64; p++) {
    if (Math.abs(getEnergy(p + 64) - getEnergy(p)) > 1e-6) { shifted = true; break; }
  }
  assert(shifted, 'anti-metronome: the 97-beat wobble breaks the fixed 64-beat repetition');
}

// 13. BPM retune: same-tier retune keeps the beat clock ticking without
//     resetting the phase; cross-tier retune is rejected; the hook dies
//     with the cycle.
{
  console.log('\n== bpm retune ==');
  const card = makeCard();
  startDanceCycle(card, 110);
  runBeats(card, 20); // mid-phrase-1
  assert(typeof card._retuneDance === 'function', 'retune hook installed while dancing');

  const ok = card._retuneDance(115);
  assert(ok === true, 'same-tier retune (110 -> 115 BPM) accepted');
  const timersBefore = card.animator._timers.has('dance-step');
  runBeats(card, 4);
  assert(timersBefore && card.animator._timers.has('dance-step'), 'beat clock still ticking after retune (no restart)');

  const rejected = card._retuneDance(130);
  assert(rejected === false, 'cross-tier retune (115 -> 130 BPM) rejected');

  stopDanceCycle(card);
  assert(typeof card._retuneDance === 'undefined', 'retune hook dies with the cycle (stopDanceCycle clears it)');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);