/**
 * behaviors/choreography.js — Phrase library (legacy port) + selector.
 *
 * The dance vocabulary is a DIRECT PORT of the legacy card's 32 hand-written
 * per-beat choreography blocks (8 per BPM tier, see memory-bank/legacy-card.md
 * startDanceCycle). Every pose function preserves the legacy arithmetic
 * exactly — sines, per-beat value arrays, phaseMod4/phaseMod8 indexing, seeded
 * random jerks — because that arithmetic is what made the legacy dance read as
 * dynamic. The phrase-local beat `b` is a 16-beat bar; 16 is divisible by 4
 * and 8, so b % 4 / b % 8 equal the legacy dancePhase % 4 / % 8. The one
 * legacy block keyed on dancePhase % 3 receives the GLOBAL beat counter
 * through the context (`c.global`).
 *
 * What the rewrite deliberately does NOT do to the ported poses:
 *  - No amplitude modulation. The legacy poses hit their designed amplitudes
 *    100% of the time; the only scale applied is the harmless variant jitter
 *    (0.9-1.1). Energy governs PHRASE SELECTION only (pickNextPhrase).
 *  - No establish ramp, no resolve pre-blend. Legacy blocks hard-cut every
 *    16 beats — the cut itself is what read as "new move".
 *  - No PENDULUM coupling: legacy poses move tx independently of r all over
 *    the vocabulary (pure sways with r = 0, tx arrays, random jerks). The
 *    port preserves that decoupling — it is a large part of the dynamism.
 *
 * Phrase selection: uniform random over the whole tier vocabulary with no
 * immediate repeat, gated by the continuous energy envelope (PEAK_GATE /
 * PEAK_MARGIN keep wild phrases out of low-energy windows). Deterministic:
 * seeded by (phraseCount, tier, current phrase).
 *
 * Pure data + pure functions — no DOM. Consumed by behaviors/dance.js.
 */

// ---- Deterministic PRNG (the anti-randomness contract) ----

/** 32-bit integer hash (Thomas Wang). Deterministic scramble. */
export function hash32(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return n >>> 0;
}

/** mulberry32 seeded PRNG — deterministic stream from an integer seed.
 *  Exported so the verify script can replicate pose contexts exactly. */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Continuous energy envelope (verse/chorus dynamics) ----

/** Window target energies: groove -> build -> peak -> release, repeating. */
export const ENERGY_WINDOWS = [0.5, 0.75, 1.0, 0.6];

/** Envelope floor/ceiling clamp. */
const ENERGY_MIN = 0.3;
const ENERGY_MAX = 1.1;

// Radial pupil-dart clamp per tier (px). The iris (r=17.6) inside the socket
// face (r=23) leaves a 5.4 px translation budget; these caps keep the dart
// expressive while the iris edge stays well inside the rim. Enforced in
// getBeatPose; socketClip in template.js is the geometric backstop.
const DART_MAX = [3, 6, 6, 9];

/**
 * Energy at a global beat index — a CONTINUOUS curve, not plateaus.
 * Cosine interpolation between window centers (beats 8/24/40/56) plus a slow
 * co-prime wobble (period 97) so the combined pattern repeats only every
 * 6208 beats. Energy now drives PHRASE SELECTION only — it no longer scales
 * pose amplitude.
 */
export function getEnergy(dancePhase) {
  const phase = ((dancePhase % 64) + 64) % 64;
  const center = phase - 8;
  const seg = Math.floor(center / 16);
  const t = (center - seg * 16) / 16;
  const from = ENERGY_WINDOWS[((seg % 4) + 4) % 4];
  const to = ENERGY_WINDOWS[(((seg + 1) % 4) + 4) % 4];
  const base = from + (to - from) * (0.5 - 0.5 * Math.cos(t * Math.PI));
  const wobble = 0.09 * Math.sin((2 * Math.PI * dancePhase) / 97);
  return Math.min(ENERGY_MAX, Math.max(ENERGY_MIN, base + wobble));
}

// ---- Move factories ----

/** HIT move: snappy transition (downbeat overshoot / offbeat snap in dance.js). */
const hit = (r, tx, ty, s, lid, durBeats, pump, dart) => ({
  r, tx, ty, s, lid, dart: dart || null, flow: false, durBeats, pump,
});

/** FLOW move: continuous ease-in-out glide. */
const flow = (r, tx, ty, s, lid, durBeats, pump) => ({
  r, tx, ty, s, lid, dart: null, flow: true, durBeats, pump,
});

// ---- Phrase library (ported from the legacy card's 32 blocks) ----
//
// pose(b, c) -> move, where b = beat-in-phrase (0-15) and
// c = { isDown, quad, m4, m8, lead, global, rnd }.
//   isDown: b % 2 === 0  (legacy isDownBeat)
//   quad:   b % 4 === 0  (legacy isQuadBeat)
//   m4/m8:  b % 4 / b % 8  (legacy phaseMod4 / phaseMod8 — 16 % 8 === 0)
//   global: global beat counter (only the legacy dancePhase % 3 block uses it)
//   rnd:    seeded per (phrase, beat) — ALL pose randomness flows through it
//
// pump = bellows compression px on the downbeat (0 on offbeats — the bellows
// is gravity-coupled). dart = [dx, dy] pupil accent on downbeats. Raw phrase
// amplitudes are clamped radially in getBeatPose to DART_MAX per tier — the
// iris (r=17.6) sits inside the socket face (r=23), leaving only a 5.4 px
// translation budget before the iris edge crosses the rim. halo/strobe are
// phrase-level personality accents read by dance.js.
//
// Tier 0 note: the legacy <90 tier skipped off-beats entirely
// (`if (!isDownBeat) return executeTick()`), so every legacy expression was
// only ever evaluated on EVEN beats. The port quantizes each pose to its
// beat PAIR (q = b - b % 2) and returns the same target for both beats with
// durBeats 2.0 — identical rendering, expressed as one long flow glide.

const TIERS = [
  // ---- Tier 0: chill (< 90 BPM) — slow pair-held sways, all FLOW ----
  {
    phrases: [
      {
        name: 'quad-tilt', energy: 0.45,
        pose(b, c) {
          const q = b - (b % 2);
          const pos = q % 4 === 0 ? 1 : -1;
          return flow(pos * 8, pos * 5, 2, 1, 0.4, 2.0, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'vertical-bob', energy: 0.4,
        pose(b, c) {
          const q = b - (b % 2);
          return flow(0, 0, q % 4 === 0 ? 15 : -5, 1, 0.4, 2.0, c.isDown ? 3 : 0);
        },
      },
      {
        name: 'sway-bob', energy: 0.5,
        // ADAPTED (intent-restored): legacy r = sin(phase*PI/2)*6 evaluated
        // only on even beats is identically 0 — the lateral sway never
        // rendered. Restored as a pure sway (r = 0, tx on the sine) so tier 0
        // has its body-shift phrase; see the tier-3 asymmetry note below.
        pose(b, c) {
          const q = b - (b % 2);
          return flow(0, Math.sin(q * Math.PI / 4) * 5,
            Math.cos(q * Math.PI / 4) * 8 + 4, 1, 0.4, 2.0, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'slow-arc', energy: 0.5,
        pose(b, c) {
          const q = b - (b % 2);
          const pos = q % 8 < 4 ? 1 : -1;
          return flow(pos * 10, pos * 4, 5, 1, 0.4, 2.0, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'rotation-sweep', energy: 0.55,
        pose(b, c) {
          const q = b - (b % 2);
          return flow(Math.sin(q * Math.PI / 4) * 12, 0, 0, 1, 0.4, 2.0, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'dip-bob', energy: 0.45,
        pose(b, c) {
          const q = b - (b % 2);
          const up = q % 4 === 0;
          return flow(up ? 4 : -4, 0, up ? 12 : 2, up ? 1.03 : 1.0, 0.4, 2.0, c.isDown ? 3 : 0);
        },
      },
      {
        name: 'accent-nod', energy: 0.5,
        pose(b, c) {
          const q = b - (b % 2);
          const m8 = q % 8;
          const r = m8 === 0 ? 12 : (m8 === 4 ? -6 : 0);
          return flow(r, r * 0.5, 8, 1, 0.4, 2.0, c.isDown ? 3 : 0);
        },
      },
      {
        name: 'settle-rest', energy: 0.2, halo: 0.8,
        pose(b, c) {
          return flow(0, 0, 2, 1.05, 0.5, 2.0, c.isDown ? 1 : 0);
        },
      },
    ],
  },

  // ---- Tier 1: groovy (90-125 BPM) — confident hits, every-beat alternation ----
  {
    phrases: [
      {
        name: 'headbang', energy: 0.5,
        pose(b, c) {
          return hit(c.isDown ? 7 : -7, 0, c.isDown ? 8 : -2, c.isDown ? 1.02 : 1.0,
            0.2, 0.8, c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null);
        },
      },
      {
        name: 'side-hold', energy: 0.5,
        pose(b, c) {
          const side = c.m4 < 2 ? 1 : -1;
          return hit(side * 8, side * 4, c.isDown ? 10 : 2, 1, 0.2, 0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null);
        },
      },
      {
        name: 'offbeat-lift', energy: 0.55,
        // Legacy overrode the tier easing with plain ease-in-out -> FLOW.
        pose(b, c) {
          const r = c.m4 === 0 ? 10 : (c.m4 === 2 ? -10 : 0);
          return flow(r, 0, (c.m4 === 1 || c.m4 === 3) ? 12 : 0, 1, 0.2, 0.8,
            c.isDown ? 2 : 0);
        },
      },
      {
        name: 'array-tilt', energy: 0.6,
        pose(b, c) {
          return hit([10, 5, -10, -5][c.m4], 0, [0, 8, 0, 8][c.m4], 1, 0.2, 0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null);
        },
      },
      {
        name: 'pure-sway', energy: 0.5,
        pose(b, c) {
          return hit(0, c.isDown ? 8 : -8, 4, 1, 0.2, 0.8,
            c.isDown ? 2 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null);
        },
      },
      {
        name: 'full-swing', energy: 0.6,
        pose(b, c) {
          return hit(c.isDown ? 10 : -10, c.isDown ? 5 : -5, c.isDown ? 10 : -5,
            1, 0.2, 0.8, c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null);
        },
      },
      {
        name: 'offbeat-loom', energy: 0.55,
        pose(b, c) {
          return hit((c.isDown ? 1 : -1) * 6, 0, !c.isDown ? 14 : 0,
            !c.isDown ? 1.04 : 1.0, 0.2, 0.8, c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null);
        },
      },
      {
        name: 'triplet-side', energy: 0.6,
        // The one legacy block keyed on dancePhase % 3 — uses the GLOBAL beat
        // counter passed through the context.
        pose(b, c) {
          const side = (c.global % 3 === 0) ? -1 : 1;
          return hit(side * 8, 0, c.isDown ? 8 : 0, 1, 0.2, 0.8,
            c.isDown ? 3 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 8, (c.rnd() - 0.5) * 6] : null);
        },
      },
    ],
  },

  // ---- Tier 2: club (125-160 BPM) — sharp snaps, tx arrays, punch-recover ----
  {
    phrases: [
      {
        name: 'power-tilt', energy: 0.7,
        pose(b, c) {
          return hit(c.isDown ? 12 : -12, c.isDown ? 6 : -6,
            c.isDown ? 10 : -8, 1.03, c.isDown ? 0.1 : 0, 0.6,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null);
        },
      },
      {
        name: 'lateral-stutter', energy: 0.65,
        pose(b, c) {
          return hit(0, [8, 0, -8, 0][c.m4], c.isDown ? 5 : -5,
            1, c.m4 === 3 ? 0.6 : (c.isDown ? 0.1 : 0), 0.6,
            c.isDown ? 3 : 0);
        },
      },
      {
        name: 'scale-build', energy: 0.6,
        // Legacy excluded this block from pupil darts (its lid ramp IS the
        // accent) — preserved.
        pose(b, c) {
          return hit(c.isDown ? 5 : -5, 0, c.isDown ? 5 : -2,
            1.0 + c.m4 * 0.03, 0.4 - c.m4 * 0.1, 0.6, c.isDown ? 3 : 0);
        },
      },
      {
        name: 'big-snap', energy: 0.85,
        pose(b, c) {
          return hit(c.isDown ? 15 : -15, c.isDown ? 5 : -5, 8, 1,
            c.isDown ? 0.1 : 0, 0.6, c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null);
        },
      },
      {
        name: 'square-wave', energy: 0.75,
        pose(b, c) {
          return hit([10, 10, -10, -10][c.m4], [5, 5, -5, -5][c.m4],
            [8, -2, 8, -2][c.m4], 1, c.isDown ? 0.1 : 0, 0.6,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null);
        },
      },
      {
        name: 'linear-thrust', energy: 0.7,
        pose(b, c) {
          return hit((c.isDown ? 1 : -1) * 10, 0, c.isDown ? 12 : 4, 1.02,
            c.isDown ? 0.1 : 0, 0.4, c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null);
        },
      },
      {
        name: 'hole-punch', energy: 0.75,
        pose(b, c) {
          const odd = c.m4 === 1 || c.m4 === 3;
          return hit(odd ? 0 : (c.m4 === 0 ? 12 : -12), 0, odd ? 14 : -2, 1,
            c.isDown ? 0.1 : 0, 0.6, c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null);
        },
      },
      {
        name: 'punch-recover', energy: 0.9, halo: 0.8,
        // Legacy texture, verbatim: the SAME pose on both beats, snapped on
        // the downbeat (0.1 beats) and recovered slowly on the off-beat
        // (0.8 beats).
        pose(b, c) {
          return hit(12, 8, c.isDown ? 8 : -4, 1, c.isDown ? 0.1 : 0,
            c.isDown ? 0.1 : 0.8, c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 16, (c.rnd() - 0.5) * 12] : null);
        },
      },
    ],
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
        name: 'slam', energy: 0.7,
        pose(b, c) {
          return hit(0, 0, c.isDown ? 20 : -10, c.isDown ? 1.08 : 0.95,
            c.quad ? 0.4 : 0, 0.8, c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
      {
        name: 'chaos', energy: 1.0,
        // Legacy Math.random jerks -> seeded c.rnd() (determinism contract).
        // tx is drawn independently of r — the tier-3 "independent lateral"
        // phrase (tier 3 keeps its as-rendered vertical pump below instead of
        // a pure sway; chaos already owns the lateral texture).
        pose(b, c) {
          return hit((c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 15,
            (c.rnd() - 0.5) * 15, 1, c.quad ? 0.4 : 0, 0.5,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
      {
        name: 'whip', energy: 0.9,
        pose(b, c) {
          return hit(c.isDown ? 18 : -18, c.isDown ? 10 : -10, 12, 1,
            c.quad ? 0.4 : 0, 0.8, c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
      {
        name: 'glitch', energy: 1.0, halo: 0.8,
        pose(b, c) {
          return hit(c.isDown ? 10 : -10, (c.rnd() - 0.5) * 20, 15, 1.1,
            c.quad ? 0.4 : 0, 0.8, c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
      {
        name: 'assault', energy: 1.0,
        pose(b, c) {
          return hit(c.isDown ? 25 : -25, c.isDown ? 15 : -15,
            c.isDown ? 15 : -15, 1, c.quad ? 0.4 : 0, 0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
      {
        name: 'jackhammer', energy: 0.8,
        pose(b, c) {
          return hit(0, 0, c.isDown ? 12 : 2, 1, c.quad ? 0.4 : 0, 0.3,
            c.isDown ? 4 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
      {
        name: 'pump', energy: 0.9,
        // ADAPTED (as-rendered): legacy ty = cos(phase*PI/2)*15+5 sampled at
        // integer beats is the period-4 sequence [20, 5, -10, 5]; the
        // authored r/tx sines (sin(phase*PI)) are identically 0 at integer
        // beats, so the block RENDERED as a pure vertical pump. Ported
        // as-rendered — tier 3's lateral texture comes from chaos/glitch.
        pose(b, c) {
          return hit(0, 0, [20, 5, -10, 5][c.m4], 1, c.quad ? 0.4 : 0, 0.8,
            c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
      {
        name: 'strobe-slam', energy: 1.0, halo: 0.8, strobe: true,
        // Legacy finale, verbatim: same pose held across the bar, snapped on
        // the m4===0 downbeat (0.1 beats) and recovered long (1.5 beats);
        // #eye-center strobes red/white every beat (dance.js).
        pose(b, c) {
          return hit(15, 0, 10, 1.1, c.quad ? 0.4 : 0,
            c.m4 === 0 ? 0.1 : 1.5, c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 30, (c.rnd() - 0.5) * 30] : null);
        },
      },
    ],
  },
];

export { TIERS };

// ---- Phrase selector ----

const PEAK_GATE = 0.8;   // phrases above this energy are peak-gated
const PEAK_MARGIN = 0.3; // ...and need window energy >= energy - margin

/**
 * Pick the next phrase at the bar boundary: uniform random over the WHOLE
 * tier vocabulary with no immediate repeat, gated by the switch-time energy
 * (peak phrases only enter high-energy windows). Deterministic: seeded by
 * (phraseCount, tier, current phrase). If the energy gate empties the pool
 * (e.g. deep in a low-energy window in a wild tier), the gate is lifted for
 * that one switch rather than stalling the walk.
 */
export function pickNextPhrase(tierIdx, currentId, switchEnergy, phraseCount) {
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
    Math.imul(phraseCount + 1, 0x9e3779b1)
    ^ Math.imul(tierIdx + 1, 0x85ebca77)
    ^ Math.imul(currentId + 1, 0xc2b2ae3d)
  ));
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

/**
 * Per-phrase variant: mirrored lead (kept for API compatibility; the ported
 * legacy poses are sign-fixed and do not consume it) + amplitude jitter
 * (0.9-1.1, harmless), seeded per (phraseCount, phrase, tier).
 */
export function phraseVariant(tierIdx, phraseId, phraseCount) {
  const rnd = mulberry32(hash32(
    Math.imul(phraseCount + 1, 0x9e3779b1)
    ^ Math.imul(phraseId + 1, 0x27d4eb2f)
    ^ Math.imul(tierIdx + 1, 0x165667b1)
  ));
  return { lead: rnd() < 0.5 ? 1 : -1, jitter: 0.9 + rnd() * 0.2 };
}

/**
 * The pose for one beat of a phrase — the single choreography entry point.
 *
 * Applies ONLY the variant jitter on top of the phrase's pose function: the
 * legacy amplitudes land at full designed strength every beat. There is no
 * establish ramp, no energy-arc amplitude scale, and no resolve pre-blend —
 * phrase changes are hard cuts at the bar boundary (the legacy model), and
 * phrase-to-phrase amplitude contrast is the ONLY size contrast in the dance.
 *
 * @param {number} tierIdx   0-3 tempo tier
 * @param {number} phraseId  current phrase index
 * @param {number} b         beat within the phrase (0-15)
 * @param {{lead:number, jitter:number}} variant  from phraseVariant()
 * @param {number} globalBeat global beat counter (feeds c.global for the
 *                            legacy dancePhase % 3 block)
 */
export function getBeatPose(tierIdx, phraseId, b, variant, globalBeat) {
  const phrase = TIERS[tierIdx].phrases[phraseId];
  const isDown = b % 2 === 0;
  const rnd = mulberry32(hash32(
    Math.imul(phraseId + 1, 7919) ^ Math.imul(b + 1, 104729) ^ Math.imul(tierIdx + 1, 7)
  ));
  const raw = phrase.pose(b, {
    isDown, quad: b % 4 === 0, m4: b % 4, m8: b % 8,
    lead: variant.lead, global: globalBeat, rnd,
  });
  const k = variant.jitter;
  // Pupil darts are clamped radially to DART_MAX[tier]. The iris (r=17.6)
  // sits inside the socket face (r=23) — only a 5.4 px translation budget
  // before the iris edge crosses the rim. Raw phrase darts were transcribed
  // from legacy HEAD amplitudes and can request up to ±15 px; the clamp
  // bounds every phrase (current and future) in one place. The socketClip
  // wrapper in template.js is the geometric backstop.
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
    strobe: phrase.strobe === true,
  };
}