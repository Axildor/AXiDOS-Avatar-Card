/**
 * behaviors/choreography.js — Phrase-graph choreography data + walker.
 *
 * The dance is composed from 16-beat PHRASES instead of randomly-rotated
 * routine blocks. Each phrase is a named GLaDOS-authentic move built on the
 * model's physical vocabulary (neck-pivot tilt, crane dip, bellows compress,
 * torso swivel) and obeys five physical laws:
 *
 *  1. GRAVITY: the downbeat DIPS (ty down + bellows compress); the offbeat
 *     rises. Never inverted — a suspended head dips INTO the beat.
 *  2. PENDULUM: lateral drift is coupled to tilt (tx = r * k) — a hanging
 *     head swings in an arc, it does not slide sideways while tilting.
 *  3. TORSO LAG: the ceiling-mount swivel follows the head at half amplitude
 *     over multi-beat durations (applied in dance.js).
 *  4. PRECISION: direction reversals land ON beats; a move and its mirror
 *     alternate with mechanical regularity inside a phrase — her "routine"
 *     reads as deliberate, like her idle scans.
 *  5. PERSONALITY: lids + pupil sell the emotion (groove = half-lidded,
 *     peak = wide-eye loom, resolve = softened).
 *
 * Phrase internal arc: beats 0-3 ESTABLISH the signature move (amplitude
 * ramps 70% -> 100%), beats 4-12 DEVELOP it, and beats 13-15 RESOLVE toward
 * the NEXT phrase's entry pose — a choreographed handoff that replaces the
 * old reactive transition damper.
 *
 * A 64-beat ENERGY ARC (groove -> build -> peak -> release) gates which
 * phrases the graph walker may pick (peak phrases only during high-energy
 * windows) and scales move amplitude — verse/chorus dynamics.
 *
 * All variation is SEEDED (hash of phrase id/tier/beat) — no Math.random:
 * the same beat always produces the same choreography, so the motion reads
 * as intentional and is fully verifiable.
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

/** mulberry32 seeded PRNG — deterministic stream from an integer seed. */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 64-beat energy arc (verse/chorus dynamics) ----

/** Window target energies: groove -> build -> peak -> release, repeating.
 *  Widened floor (was [0.35, 0.65, 1.0, 0.45]): the dance now spends far
 *  more time near peak — the low windows still breathe, but never read as
 *  "not dancing" (the old 0.35 groove window damped every move ~15%). */
export const ENERGY_WINDOWS = [0.5, 0.75, 1.0, 0.6];

/**
 * Energy at a global beat index. Each 16-beat phrase window sits at its
 * window's target energy; the last 3 beats blend toward the NEXT window's
 * target so amplitude grows/falls into the switch (the resolve section
 * literally builds into the next phrase).
 */
export function getEnergy(dancePhase) {
  const macro = ((dancePhase % 64) + 64) % 64;
  const win = Math.floor(macro / 16);
  const b = macro % 16;
  const cur = ENERGY_WINDOWS[win];
  if (b < 12) return cur;
  const next = ENERGY_WINDOWS[(win + 1) % 4];
  return cur + (next - cur) * ((b - 12) / 3);
}

// ---- Physical-law helpers ----

/** GRAVITY law: downbeat dips down (ty+), offbeat rises (ty-). */
const dip = (isDown, depth) => (isDown ? depth : -depth * 0.45);

/** Side alternation every 2 beats, mirrored by the phrase's lead variant. */
const side2 = (b, lead) => (Math.floor(b / 2) % 2 === 0 ? 1 : -1) * lead;

/** HIT move: snappy keyframed pose (windup/overshoot built in dance.js). */
const hit = (r, tx, ty, s, lid, durBeats, pump, dart) => ({
  r, tx, ty, s, lid, dart: dart || null, flow: false, durBeats, pump,
});

/** FLOW move: continuous ease-in-out glide (no hit, no freeze). */
const flow = (r, tx, ty, s, lid, durBeats, pump) => ({
  r, tx, ty, s, lid, dart: null, flow: true, durBeats, pump,
});

// ---- Phrase library ----
//
// pose(b, c) -> move, where b = beat-in-phrase (0-15) and
// c = { isDown, quad, m4, m8, lead, rnd }. Amplitude scaling (energy arc,
// establish ramp, jitter variant) is applied by getBeatPose — pose functions
// return FULL-amplitude targets.
//
// pump = bellows compression px on the downbeat (GRAVITY law: compress
// into the dip, release on the rise). dart = [dx, dy] pupil accent.

const TIERS = [
  // ---- Tier 0: chill (< 90 BPM) — all FLOW, slow suspended sways ----
  {
    phrases: [
      {
        name: 'pendulum-sway', energy: 0.3, entry: [4, 2, 5, 1],
        pose(b, c) {
          const r = side2(b, c.lead) * 10;
          return flow(r, r * 0.5, 5 + dip(c.isDown, 4), 1, 0.35, 1.9, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'crane-sweep', energy: 0.45, entry: [6, 2, 4, 1],
        pose(b, c) {
          const r = c.lead * 12 * Math.sin((b * Math.PI) / 8);
          return flow(r, r * 0.4, 4 + dip(c.isDown, 3), 1, 0.3, 1.9, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'slow-loom', energy: 0.35, entry: [0, 0, 7, 1.02],
        pose(b, c) {
          const r = Math.sin((b * Math.PI) / 4) * 4;
          return flow(r, r * 0.5, 7 + dip(c.isDown, 5), c.isDown ? 1.04 : 1.0, 0.45, 1.9, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'bob-drift', energy: 0.5, entry: [0, 0, 7, 1],
        pose(b, c) {
          const r = Math.sin((b * Math.PI) / 2) * 5;
          return flow(r, r * 0.6, 7 + dip(c.isDown, 7), 1, 0.3, 1.9, c.isDown ? 2 : 0);
        },
      },
      {
        name: 'settle-rest', energy: 0.15, entry: [0, 0, 3, 1],
        pose(b, c) {
          const r = Math.sin((b * Math.PI) / 4) * 3;
          return flow(r, r * 0.5, 3 + dip(c.isDown, 2), 1, 0.55, 1.9, c.isDown ? 1 : 0);
        },
      },
    ],
    edges: [
      [[1, 0.35], [2, 0.3], [3, 0.25], [4, 0.1]],
      [[0, 0.3], [2, 0.25], [3, 0.2], [4, 0.25]],
      [[0, 0.3], [1, 0.25], [3, 0.2], [4, 0.25]],
      [[0, 0.3], [1, 0.25], [2, 0.2], [4, 0.25]],
      [[0, 0.4], [1, 0.3], [2, 0.3]],
    ],
  },

  // ---- Tier 1: groovy (90-125 BPM) — confident hits on the beat ----
  {
    phrases: [
      {
        name: 'metronome-rock', energy: 0.5, entry: [5, 2, 5, 1],
        pose(b, c) {
          const r = side2(b, c.lead) * 10;
          return hit(r, r * 0.5, 5 + dip(c.isDown, 6), c.isDown ? 1.02 : 0.99, 0.2, 0.8,
            c.isDown ? 3 : 0, c.quad ? [(c.rnd() - 0.5) * 4, (c.rnd() - 0.5) * 3] : null);
        },
      },
      {
        name: 'dip-nod', energy: 0.6, entry: [0, 0, 8, 1.02],
        pose(b, c) {
          return hit(0, 0, 8 + dip(c.isDown, 9), c.isDown ? 1.03 : 0.98, 0.25, 0.8, c.isDown ? 4 : 0);
        },
      },
      {
        name: 'swivel-groove', energy: 0.65, entry: [6, 3, 6, 1],
        pose(b, c) {
          const r = c.lead * 10 * Math.sin((b * Math.PI) / 4);
          return hit(r, r * 0.5, 6 + dip(c.isDown, 4), 1, 0.2, 0.8, c.isDown ? 3 : 0);
        },
      },
      {
        name: 'bounce-build', energy: 0.8, entry: [0, 0, 6, 1.02],
        pose(b, c) {
          const k = 0.6 + (b / 16) * 0.8; // amplitude grows across the phrase
          const r = side2(b, c.lead) * 8 * k;
          return hit(r, r * 0.5, 6 + dip(c.isDown, 9 * k),
            c.isDown ? 1 + 0.04 * k : 1 - 0.02 * k, 0.15, 0.8, c.isDown ? 3 + 2 * k : 0);
        },
      },
      {
        name: 'groove-release', energy: 0.3, entry: [4, 2, 4, 1],
        pose(b, c) {
          const r = side2(b, c.lead) * 6;
          return flow(r, r * 0.5, 4 + dip(c.isDown, 3), 1, 0.4, 1.5, c.isDown ? 2 : 0);
        },
      },
    ],
    edges: [
      [[1, 0.3], [2, 0.3], [3, 0.25], [4, 0.15]],
      [[0, 0.3], [2, 0.3], [3, 0.2], [4, 0.2]],
      [[0, 0.25], [1, 0.25], [3, 0.3], [4, 0.2]],
      [[0, 0.3], [2, 0.3], [4, 0.4]],
      [[0, 0.35], [1, 0.35], [2, 0.3]],
    ],
  },

  // ---- Tier 2: club (125-160 BPM) — sharp snaps, looms, the drop ----
  {
    phrases: [
      {
        name: 'dip-loom', energy: 0.7, entry: [5, 2, 6, 1.02],
        pose(b, c) {
          const r = side2(b, c.lead) * 7;
          return hit(r, r * 0.5, 6 + dip(c.isDown, 8), c.isDown ? 1.04 : 0.97,
            c.isDown ? 0.1 : 0, 0.6, c.isDown ? 4 : 0);
        },
      },
      {
        name: 'snap-swivel', energy: 0.85, entry: [7, 3, 5, 1],
        pose(b, c) {
          const r = side2(b, c.lead) * (c.isDown ? 15 : 4.5); // snap, then hold-back
          return hit(r, r * 0.4, 5 + dip(c.isDown, 5), 1, 0.1, c.isDown ? 0.5 : 0.6, c.isDown ? 4 : 0);
        },
      },
      {
        name: 'pendulum-pump', energy: 0.75, entry: [6, 3, 5, 1],
        pose(b, c) {
          const r = (b % 2 === 0 ? 1 : -1) * c.lead * 13;
          return hit(r, r * 0.5, 5 + dip(c.isDown, 5), 1.01, 0.15, 0.6, c.isDown ? 4 : 0);
        },
      },
      {
        name: 'peak-stomp', energy: 1.0, entry: [10, 5, 8, 1.03], halo: 0.8,
        pose(b, c) {
          const r = side2(b, c.lead) * 18;
          return hit(r, r * 0.5, 8 + dip(c.isDown, 10), c.isDown ? 1.06 : 0.97, 0, 0.45, c.isDown ? 5 : 0);
        },
      },
      {
        name: 'club-release', energy: 0.4, entry: [4, 2, 4, 1],
        pose(b, c) {
          const r = side2(b, c.lead) * 8;
          return flow(r, r * 0.5, 4 + dip(c.isDown, 4), 1, 0.3, 1.6, c.isDown ? 2 : 0);
        },
      },
    ],
    edges: [
      [[1, 0.3], [2, 0.3], [3, 0.2], [4, 0.2]],
      [[0, 0.15], [2, 0.25], [3, 0.35], [4, 0.25]],
      [[0, 0.2], [1, 0.3], [3, 0.3], [4, 0.2]],
      [[0, 0.3], [2, 0.2], [4, 0.5]],
      [[0, 0.4], [1, 0.3], [2, 0.3]],
    ],
  },

  // ---- Tier 3: hardcore (160+ BPM) — mechanical assault, seeded chaos ----
  {
    phrases: [
      {
        name: 'violent-pendulum', energy: 0.75, entry: [10, 5, 6, 1],
        pose(b, c) {
          const r = (b % 2 === 0 ? 1 : -1) * c.lead * 20;
          return hit(r, r * 0.5, 6 + dip(c.isDown, 8), c.isDown ? 1.04 : 0.97, 0.1, 0.8, c.isDown ? 5 : 0);
        },
      },
      {
        name: 'servo-stutter', energy: 1.0, entry: [0, 0, 5, 1.03],
        pose(b, c) {
          // Seeded mechanical glitch: positions quantized to 9-degree servo
          // steps from a per-beat seeded stream — wild but COHERENT (the same
          // phrase always stutters the same way), never per-beat noise.
          const r = (Math.floor(c.rnd() * 5) - 2) * 9;
          return hit(r, r * 0.4, 5 + dip(c.isDown, 6), c.isDown ? 1.05 : 0.96,
            c.quad ? 0.5 : 0.1, 0.5, c.isDown ? 5 : 0,
            c.isDown ? [(c.rnd() - 0.5) * 9, (c.rnd() - 0.5) * 7] : null);
        },
      },
      {
        name: 'loom-assault', energy: 0.95, entry: [0, 0, 8, 1.05], halo: 0.8,
        pose(b, c) {
          return hit(0, 0, 8 + dip(c.isDown, 9), c.isDown ? 1.09 : 0.95, 0,
            c.isDown ? 0.4 : 0.7, c.isDown ? 5 : 0);
        },
      },
      {
        name: 'stomp-cycle', energy: 1.0, entry: [8, 4, 10, 1.04],
        pose(b, c) {
          const r = side2(b, c.lead) * 13;
          return hit(r, r * 0.5, 10 + dip(c.isDown, 11), c.isDown ? 1.07 : 0.96, 0.05, 0.8, c.isDown ? 5 : 0);
        },
      },
      {
        name: 'hardcore-release', energy: 0.5, entry: [5, 2, 4, 1],
        pose(b, c) {
          const r = side2(b, c.lead) * 8 * (1 - b / 20); // mechanical wind-down
          return flow(r, r * 0.5, 4 + dip(c.isDown, 4), 1, 0.35, 1.4, c.isDown ? 2 : 0);
        },
      },
    ],
    edges: [
      [[1, 0.3], [2, 0.2], [3, 0.3], [4, 0.2]],
      [[0, 0.25], [2, 0.3], [3, 0.25], [4, 0.2]],
      [[0, 0.2], [1, 0.25], [3, 0.35], [4, 0.2]],
      [[0, 0.35], [1, 0.25], [4, 0.4]],
      [[0, 0.35], [2, 0.3], [3, 0.35]],
    ],
  },
];

export { TIERS };

// ---- Graph walker ----

const PEAK_GATE = 0.8;   // phrases above this energy are peak-gated
const PEAK_MARGIN = 0.3; // ...and need window energy >= energy - margin

/**
 * Pick the next phrase from the current phrase's transition edges, gated by
 * the energy of the window the next phrase will play in. Deterministic:
 * seeded by (phraseCount, tier, current phrase) — the same dance always
 * walks the same graph.
 */
export function pickNextPhrase(tierIdx, currentId, nextWindowEnergy, phraseCount) {
  const tier = TIERS[tierIdx];
  const edges = tier.edges[currentId] || [];
  const eligible = edges.filter(([to]) => {
    const p = tier.phrases[to];
    return p.energy <= PEAK_GATE || nextWindowEnergy >= p.energy - PEAK_MARGIN;
  });
  const pool = eligible.length > 0 ? eligible : edges;
  const rnd = mulberry32(hash32(
    Math.imul(phraseCount + 1, 0x9e3779b1)
    ^ Math.imul(tierIdx + 1, 0x85ebca77)
    ^ Math.imul(currentId + 1, 0xc2b2ae3d)
  ));
  let roll = rnd() * pool.reduce((s, e) => s + e[1], 0);
  for (const [to, w] of pool) {
    roll -= w;
    if (roll <= 0) return to;
  }
  return pool[pool.length - 1][0];
}

/**
 * Per-phrase variant: mirrored lead (left/right) + amplitude jitter, seeded
 * per (phraseCount, phrase, tier). Computed once when a phrase starts.
 */
export function phraseVariant(tierIdx, phraseId, phraseCount) {
  const rnd = mulberry32(hash32(
    Math.imul(phraseCount + 1, 0x9e3779b1)
    ^ Math.imul(phraseId + 1, 0x27d4eb2f)
    ^ Math.imul(tierIdx + 1, 0x165667b1)
  ));
  return { lead: rnd() < 0.5 ? 1 : -1, jitter: 0.9 + rnd() * 0.2 };
}

/** The entry pose a phrase expects to be handed off INTO. */
export function getPhraseEntry(tierIdx, phraseId) {
  return TIERS[tierIdx].phrases[phraseId].entry;
}

/**
 * The pose for one beat of a phrase — the single choreography entry point.
 *
 * Applies, in order: the phrase's pose function, the establish ramp
 * (beats 0-3: 70% -> 100% amplitude), the energy-arc amplitude scale, the
 * variant jitter, and the RESOLVE handoff (beats 13-15 blend toward the
 * next phrase's entry pose as flow glides).
 *
 * @param {number} tierIdx   0-3 tempo tier
 * @param {number} phraseId  current phrase index
 * @param {number} b         beat within the phrase (0-15)
 * @param {{lead:number, jitter:number}} variant  from phraseVariant()
 * @param {number} energy    current energy-arc value (getEnergy)
 * @param {number[]|null} nextEntry  next phrase's entry pose (beats 13-15)
 */
export function getBeatPose(tierIdx, phraseId, b, variant, energy, nextEntry) {
  const phrase = TIERS[tierIdx].phrases[phraseId];
  const isDown = b % 2 === 0;
  const rnd = mulberry32(hash32(
    Math.imul(phraseId + 1, 7919) ^ Math.imul(b + 1, 104729) ^ Math.imul(tierIdx + 1, 7)
  ));
  const raw = phrase.pose(b, { isDown, quad: b % 4 === 0, m4: b % 4, m8: b % 8, lead: variant.lead, rnd });

  // Amplitude chain: establish ramp x energy arc x variant jitter.
  // Tiers 2-3 (club/hardcore) skip the establish ramp — they hit at FULL
  // power from beat 0; chill/groovy keep the 4-beat wind-up.
  const establish = (tierIdx >= 2 || b >= 4) ? 1 : 0.7 + 0.1 * b;
  // Raised floor (was 0.85 + 0.2 * energy): the old chain averaged ~0.8x,
  // which is what made the dance read as subtle. New range [0.95, 1.10].
  const k = establish * (0.95 + 0.15 * energy) * variant.jitter;
  let r = raw.r * k;
  let tx = raw.tx * k;
  let ty = raw.ty * k;
  let s = 1 + (raw.s - 1) * k;
  const pump = raw.pump * k;
  let lid = raw.lid;
  let outFlow = raw.flow;
  let durBeats = raw.durBeats;

  // RESOLVE handoff: beats 13-15 glide toward the next phrase's entry pose.
  // Flow glides with ease-in-out — the style switch reads as deliberate.
  if (nextEntry && b >= 13) {
    const w = (b - 12) / 3; // 1/3, 2/3, 1
    r += (nextEntry[0] - r) * w;
    tx += (nextEntry[1] - tx) * w;
    ty += (nextEntry[2] - ty) * w;
    s += (nextEntry[3] - s) * w;
    outFlow = true;
    durBeats = 1.6;
    lid = Math.max(lid, 0.2);
  }

  return {
    r, tx, ty, s, lid, pump,
    flow: outFlow,
    durBeats,
    dart: raw.dart,
    halo: phrase.halo,
  };
}