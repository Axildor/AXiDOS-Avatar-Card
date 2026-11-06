/**
 * behaviors/talk.js — the responding state: deadpan speech.
 *
 * 5.8.0 REBUILD. The pre-5.8.0 version cycled a fixed 9-pose list at a fixed
 * cadence (each pose's own `dur`), which read as a bobblehead: constant
 * motion, uniform rhythm, no phrase structure. GLaDOS does not gesticulate —
 * she makes a POINT and then holds still while you absorb it.
 *
 * The engine is now a seeded phrase walker:
 *   - a phrase is 2–4 beats of aperture punctuation plus ONE sharp accent;
 *   - phrase SELECTION is seeded and never repeats the previous phrase;
 *   - holds dominate: most of the time she is motionless with the optic in a
 *     narrow appraisal aperture;
 *   - accents are SHARP (fast attack, hard stop) rather than eased.
 *
 * COST: cheaper than the old loop. The old version issued 4 writes (head, lid,
 * pupil, swivel) every `dur` seconds forever. This one issues one accent write
 * per phrase, plus a hold write when the aperture changes, and sleeps for the
 * hold. On a 4-beat phrase that is ~2 writes per 4 beats instead of 12.
 *
 * Tracked resource names: 'talk-step', 'talk-accent'.
 */

import { hash32, mulberry32 } from './choreography.js';
import { APERTURE, SERVO_HARD_STOP_EASE } from './mechanical.js';
import { servoAmplitude } from '../personality.js';

/**
 * Phrase library. Each phrase is one accent followed by a hold.
 *
 *   accent  — the sharp head move (degrees / px / scale)
 *   lid     — the aperture state the phrase punctuates with
 *   holdMs  — how long the pose is held (the performance is the pause)
 *   attack  — accent duration in seconds (all SHORT: this is a snap)
 *   pupil   — the optic's own accent (tiny; the housing does the work)
 */
export const TALK_PHRASES = [
  // A single clipped nod: the "you are wrong and I am not going to argue".
  { accent: { r: 3, tx: 0, ty: 9, s: 1.03 }, lid: APERTURE.narrow, holdMs: 2400, attack: 0.16, pupil: [0, 2] },
  // A slow lean toward the viewer, aperture open: attention.
  { accent: { r: -4, tx: -3, ty: -7, s: 1.05 }, lid: APERTURE.wide, holdMs: 2000, attack: 0.28, pupil: [-1, -1] },
  // A hard lateral snap and back to dead centre: dismissal.
  { accent: { r: 7, tx: 6, ty: 2, s: 0.99 }, lid: APERTURE.narrow, holdMs: 2800, attack: 0.14, pupil: [3, 0] },
  // A tiny upward tick: the smallest possible acknowledgement.
  { accent: { r: 0, tx: 0, ty: -5, s: 1.02 }, lid: APERTURE.half, holdMs: 3200, attack: 0.12, pupil: [0, -2] },
  // A slow settle downward with a half aperture: "obviously".
  { accent: { r: -2, tx: 0, ty: 6, s: 1.0 }, lid: APERTURE.half, holdMs: 2600, attack: 0.3, pupil: [0, 1] },
];

/** No phrase may follow itself — the repeat is the tell that kills the read. */
export function pickTalkPhrase(previous, index, seed = 0) {
  const n = TALK_PHRASES.length;
  if (n <= 1) return 0;
  const rnd = mulberry32(hash32(
    (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul((previous + 1), 0x85ebca77) ^ seed) >>> 0,
  ));
  const pool = [];
  for (let i = 0; i < n; i++) if (i !== previous) pool.push(i);
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

export function startTalkAnim(card) {
  const a = card.animator;
  a.clearTimeout('talk-step');
  a.clearTimeout('talk-accent');
  const p = card._personality;
  const k = p ? servoAmplitude(1, p) : 1;

  let index = 0;
  let previous = -1;

  const step = () => {
    if (card._state !== 'responding') return;
    const id = pickTalkPhrase(previous, index, card._talkSeed || 0);
    previous = id;
    const phrase = TALK_PHRASES[id];
    const accent = phrase.accent;

    // The accent: ONE write, fast attack, hard stop. The aperture punctuates
    // the accent rather than tracking it.
    a.setHead(
      accent.r * k, accent.tx * k, accent.ty * k, accent.s,
      phrase.attack, SERVO_HARD_STOP_EASE,
    );
    a.setBaseLid(phrase.lid, phrase.attack);
    a.setPupil(phrase.pupil[0] * k, phrase.pupil[1] * k);
    a.setBodySwivel(accent.r * -0.45, 1, phrase.attack * 2);

    index++;
    // HOLD: the pause is the performance. Nothing is scheduled except the
    // return to the resting aperture, so the main thread sleeps through it.
    a.setTimeout('talk-accent', () => {
      if (card._state !== 'responding') return;
      a.setBaseLid(APERTURE.half, 0.6);
    }, phrase.holdMs * 0.55);

    a.setTimeout('talk-step', step, phrase.holdMs);
  };
  step();
}

export function stopTalkAnim(card) {
  card.animator.clearTimeout('talk-step');
  card.animator.clearTimeout('talk-accent');
}
