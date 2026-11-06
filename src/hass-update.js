/**
 * hass-update.js — The hass delivery pipeline, extracted from the card's
 * `set hass` so the state-recovery logic is unit-testable (the verify suites
 * drive real deliveries through this exact production code path).
 *
 * Owns: raw-state diffing (firehose gate), progress parsing, state mapping,
 * and the state application with self-healing + exception protection.
 * No DOM access of its own — all visual work is delegated to applyState()
 * (states.js) and updateProgressRing() (states.js).
 */

import { resolveState, parseBpm, parseProgress, parseMood, moodSignature } from './state-mapper.js';
import { applyState, updateProgressRing } from './states.js';

/** The AX BPM integration's dedicated mood entity (3.3.0+ naming). */
export const DEFAULT_MOOD_ENTITY = 'sensor.ax_bpm_mood';

/**
 * Resolve the mood entity id for this delivery.
 *
 * An explicitly configured `mood_entity` always wins. When it is empty we
 * opportunistically adopt the AX BPM integration's default mood entity if
 * the user has one — the 3.3.0 split moved mood off the BPM sensor with no
 * fallback, so card configs written before that split silently lost mood
 * steering on upgrade. Adopting the conventional id restores it without
 * requiring the user to edit every card, and without touching bpm_entity
 * (the split contract stays intact).
 *
 * Returns '' when nothing is configured and no default entity exists.
 */
export function resolveMoodEntity(card, hass) {
  const configured = card.config && card.config.mood_entity;
  if (configured) return configured;
  return (hass && hass.states && hass.states[DEFAULT_MOOD_ENTITY])
    ? DEFAULT_MOOD_ENTITY
    : '';
}

/**
 * Emit ONE console.warn per card instance when mood-aware style is on but no
 * usable mood data can ever arrive (5.7.2).
 *
 * Two distinct misconfigurations produce the same silent-degradation
 * symptom, so they get distinct messages:
 *   - no mood entity configured and none auto-detected → point at the
 *     sensor + the config key;
 *   - an entity resolved but it carries no mood_scores attribute → almost
 *     always the natural-but-wrong `sensor.ax_bpm` (the BPM sensor has not
 *     carried mood attributes since 3.3.0).
 *
 * Skipped entirely when mood_style_enabled is false — that user opted out,
 * so there is nothing wrong to report. Guarded by card._moodWarned so a
 * 60-frames-a-second hass firehose cannot flood the console.
 */
function warnMoodMisconfig(card, moodEntity, moodState, moodUsable) {
  if (card.config && card.config.mood_style_enabled === false) return;
  if (card._moodWarned) return;

  let message = null;
  if (!moodEntity) {
    message = 'axidos-card: mood-aware dance style is enabled but no mood_entity is '
      + `configured and ${DEFAULT_MOOD_ENTITY} was not found. Set mood_entity to the `
      + 'AX BPM integration\'s mood sensor (3.3.0+), or set mood_style_enabled: false '
      + 'to silence this warning.';
  } else if (moodState && moodUsable && moodState.attributes
    && moodState.attributes.mood_scores === undefined) {
    message = `axidos-card: mood_entity "${moodEntity}" has no mood_scores attribute, so `
      + 'mood-aware dance style has no effect. Point mood_entity at the AX BPM mood '
      + `sensor (${DEFAULT_MOOD_ENTITY} by default), not at the BPM sensor — mood moved `
      + 'off sensor.ax_bpm in AX BPM 3.3.0.';
  }
  // moodState === null (entity missing) is a transient HA state, not a
  // configuration error — it resolves itself when the integration loads.
  if (!message) return;

  card._moodWarned = true;
  console.warn(message);
}

/**
 * Process one hass delivery for a card.
 *
 * Returns true if the delivery changed anything (state applied, ring
 * updated, BPM retuned), false if it was fully gated by the firehose check.
 */
export function applyHassUpdate(card, hass) {
  if (!hass) return false;
  card._hass = hass;
  if (!card.contentReady) {
    card.setupDOM();
    card.initAxidos();
    card.contentReady = true;
  }
  const entity = card.config.entity;
  const mediaEntity = card.config.media_entity;
  const bpmEntity = card.config.bpm_entity;
  const progressEntity = card.config.progress_entity;
  const newVoiceState = (entity && hass.states[entity]) ? hass.states[entity].state.toLowerCase() : 'idle';
  const newMediaState = (mediaEntity && hass.states[mediaEntity]) ? hass.states[mediaEntity].state.toLowerCase() : 'paused';
  const newBpmState = (bpmEntity && hass.states[bpmEntity]) ? hass.states[bpmEntity].state : '120';
  const newProgressState = (progressEntity && hass.states[progressEntity]) ? hass.states[progressEntity].state : null;

  // Mood (5.7.0): read from the dedicated AX BPM mood entity (3.3.0+). Its
  // STATE is the mood label (aggressive/party/relaxed/electronic/acoustic or
  // unknown); its ATTRIBUTES carry mood_scores. The two are merged into the
  // synthetic attribute dict parseMood/moodSignature consume, so the pure
  // parsing contracts are unchanged. No mood entity (or unknown/unavailable
  // state) parses to the neutral mood — the dance stays on the plain
  // BPM-derived style.
  //
  // mood_label goes LAST so the entity STATE stays authoritative: the label
  // is the integration's argmax over the five heads, and a stale/duplicate
  // mood_label inside attributes must never override it (the pre-5.7.2
  // spread order had it the other way round).
  const moodEntity = resolveMoodEntity(card, hass);
  const moodState = (moodEntity && hass.states[moodEntity]) ? hass.states[moodEntity] : null;
  const moodUsable = moodState && moodState.state !== 'unknown' && moodState.state !== 'unavailable';
  const newMoodAttrs = moodUsable
    ? { ...moodState.attributes, mood_label: moodState.state }
    : null;
  const newMoodSig = moodSignature(newMoodAttrs);

  // One-time diagnostic (5.7.2): since the 3.3.0 mood split the BPM sensor no
  // longer carries mood attributes, so a card that never got a mood_entity
  // silently loses mood-aware dance style on upgrade — no error, no visual
  // clue. Warn exactly once per card instance so the fix is discoverable
  // without spamming the console on every delivery. There is deliberately NO
  // bpm_entity fallback: that would re-couple the two entities and
  // contradict the 3.3.0 split contract.
  warnMoodMisconfig(card, moodEntity, moodState, moodUsable);

  const mapped = resolveState(newVoiceState, newMediaState);

  // Firehose gatekeeping: only react when a tracked entity actually changed
  // AND the applied state is in sync with the mapped state. The sync check
  // makes the card self-healing: if a previous update threw mid-apply (or a
  // respond_delay timer was torn down), the raw caches say one thing while
  // card._state says another — without this, the early-return would gate
  // EVERY future delivery and the card would stay stuck (e.g. frozen in
  // responding visuals) until a page refresh. A desynced card heals on the
  // next hass delivery instead.
  if (card._lastHassVoice === newVoiceState && card._lastHassMedia === newMediaState && card._lastHassBpm === newBpmState && card._lastHassProgress === newProgressState && card._lastHassMood === newMoodSig && mapped === card._state) return false;

  card._lastHassVoice = newVoiceState;
  card._lastHassMedia = newMediaState;
  card._lastHassBpm = newBpmState;
  card._lastHassProgress = newProgressState;
  card._lastHassMood = newMoodSig;

  // Progress sensor: parse + cache on every tracked change, normalized to
  // the ring's 0-100 scale via the configured progress_min/progress_max
  // bounds. A percentage change while idle — or while dancing with
  // progress_show_in_dance on — updates the ring in place (lightweight, no
  // behavior restart); in any other state the ring is hidden and the value
  // is just cached for the next idle/dance entry.
  const prevProgress = card._progressPct;
  card._progressPct = parseProgress(newProgressState, card.config.progress_min, card.config.progress_max);
  const ringLive = card._state === 'idle'
    || (card._state === 'dancing' && card.config.progress_show_in_dance !== false);
  if (ringLive && card._progressPct !== prevProgress) {
    updateProgressRing(card);
  }

  const currentBpm = parseBpm(newBpmState);

  // Exception protection: an animation failure inside applyState must never
  // corrupt the state pipeline. applyState sets card._state BEFORE running
  // the visuals, so a mid-apply throw would otherwise leave _state already
  // updated with stale visuals — and the sync check above would consider
  // the card in-sync and gate every future delivery (the stuck-responding
  // bug). On catch we revert _state to the previous value, whose visuals
  // are what is actually still on screen; the sync check then detects the
  // desync and the next hass delivery re-applies the target state (same
  // philosophy as the guarded bopHead tap handler).
  const prevState = card._state;
  const mood = card.config.mood_style_enabled !== false ? parseMood(newMoodAttrs) : null;
  try {
    if (card._state !== mapped) {
      card._currentBpm = currentBpm;
      card._currentMood = mood;
      applyState(card, mapped, currentBpm, mood);
    } else if (mapped === 'dancing' && (card._currentBpm !== currentBpm || card._currentMood !== mood)) {
      // BPM/mood hysteresis: a same-EFFECTIVE-tier change retunes the beat
      // clock and mood directives IN PLACE (dancePhase/phraseId/phraseCount
      // preserved — no visible restart, so sensor jitter cannot flicker the
      // choreography). A change that moves the effective tier (crossing
      // 90/125/160 BPM, or a mood tier shift flipping) swaps the phrase
      // library, which requires a full restart.
      card._currentBpm = currentBpm;
      card._currentMood = mood;
      const retuned = typeof card._retuneDance === 'function' && card._retuneDance(currentBpm, mood);
      if (!retuned) applyState(card, mapped, currentBpm, mood);
    } else if (mapped !== 'responding') {
      // respond_delay timer leak guard: when the entity left 'responding'
      // while a deferred transition was still pending, card._state already
      // equals mapped (e.g. processing → processing) so applyState above is
      // skipped — but the pending 'respond-delay' timer would still fire
      // later and slam the card into responding visuals. Clear it here.
      card.animator.clearTimeout('respond-delay');
    }
  } catch (err) {
    card._state = prevState;
    console.warn('axidos-card: state apply failed, will retry on next hass update', err);
  }

  return true;
}