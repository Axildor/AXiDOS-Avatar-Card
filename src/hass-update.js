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

import { resolveState, parseBpm, parseProgress } from './state-mapper.js';
import { applyState, updateProgressRing } from './states.js';

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

  const mapped = resolveState(newVoiceState, newMediaState);

  // Firehose gatekeeping: only react when a tracked entity actually changed
  // AND the applied state is in sync with the mapped state. The sync check
  // makes the card self-healing: if a previous update threw mid-apply (or a
  // respond_delay timer was torn down), the raw caches say one thing while
  // card._state says another — without this, the early-return would gate
  // EVERY future delivery and the card would stay stuck (e.g. frozen in
  // responding visuals) until a page refresh. A desynced card heals on the
  // next hass delivery instead.
  if (card._lastHassVoice === newVoiceState && card._lastHassMedia === newMediaState && card._lastHassBpm === newBpmState && card._lastHassProgress === newProgressState && mapped === card._state) return false;

  card._lastHassVoice = newVoiceState;
  card._lastHassMedia = newMediaState;
  card._lastHassBpm = newBpmState;
  card._lastHassProgress = newProgressState;

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
  try {
    if (card._state !== mapped) {
      card._currentBpm = currentBpm;
      applyState(card, mapped, currentBpm);
    } else if (mapped === 'dancing' && card._currentBpm !== currentBpm) {
      // BPM hysteresis: a same-tier BPM change retunes the beat clock IN
      // PLACE (dancePhase/phraseId/phraseCount preserved — no visible
      // restart, so sensor jitter cannot flicker the choreography). A
      // cross-tier change (crossing 90/125/160 BPM) swaps the phrase
      // library, which requires a full restart.
      card._currentBpm = currentBpm;
      const retuned = typeof card._retuneDance === 'function' && card._retuneDance(currentBpm);
      if (!retuned) applyState(card, mapped, currentBpm);
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