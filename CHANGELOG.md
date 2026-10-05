# Changelog — AXiDOS Avatar Card

All notable changes to this project are documented in this file.

## 5.5.1

### Dance Performance Hotfix

* **Smoother dancing on low-power tablets** — removed three sources of per-beat main-thread work that stacked up at high BPM (club/hardcore tempos, 160+ BPM):
  * The ribbed grille behind the eye no longer jiggles on every beat — it now only follows the eye's gaze. This was two unguarded style writes per beat on a 32-element group for a barely-visible background texture.
  * The eyelids and the pupil's bright core are only re-styled when their value actually changes (previously four unguarded lid writes and two unguarded eye-core writes per beat).
  * At chill/groovy tempos the torso's slow sway now completes its full travel instead of being re-issued (and chopped) every beat — the sway reads smoother and the per-beat retarget cost is gone.
* **No visual choreography changes** — every move, accent, strobe, and phrase is untouched; identical style writes are simply skipped.

## 5.5.0

### Dance Motion Fixes

* **She actually dances at low BPM now** — fixed the chill tier (< 90 BPM) barely moving: the old choreography held each pose for a full 2-beat pair and glided between modest targets every ~1.6 s with no accents, which read as drifting rather than dancing. She now changes her pose **every beat** (full amplitude on the downbeat, a partial return on the off-beat), with ~40% larger amplitudes and shorter glides so each move actually lands.
* **New accents in the chill tier** — seeded pupil darts on the downbeats, a half-beat "and" syncopation dart, a slightly stronger eye pulse, and two soft hit phrases (*rotation sweep*, *dip bob*) for beat-landing texture. She stays visibly calmer than the groovy tier — the *settle rest* breather phrase is untouched.
* **Smoother dancing at high BPM** — fixed a per-beat transition-retargeting stall that dropped frame rate at club/hardcore tempos (the "skips a beat and tries to catch up" feel): the torso swivel's 3-beat transition was re-issued every beat (always interrupted at ~1/3 travel, forcing a synchronous transform read per beat), and the bellows recovery could outlive the remaining beat time. At 125+ BPM the swivel now settles within ~1 beat and the bellows recovery is capped relative to the beat length; below 125 BPM the motion is pixel-identical to before.

### Progress Ring: Dance Mode + Configurable Bounds

* **Progress ring while dancing** — the ring no longer disappears the moment the music starts. A new **Show While Dancing** toggle (default **on**) keeps the progress ring visible around the socket during dance mode, updating live with the sensor. Turn it off to restore the idle-only ring.
* **Configurable bounds** — the ring no longer assumes a 0–100 percentage sensor. New **Min Value** and **Max Value** options map any sensor range onto the ring: the sensor's `min` value renders an empty ring, `max` renders it full, and values in between scale linearly (e.g. min 20 / max 80 makes 50 read as 50%). Defaults keep the legacy 0–100 behavior; values outside the range clamp to empty/full.
* **Clean 0%** — at 0% the ring is now hidden entirely. Previously a zero-length dash still painted a small colored line at the bottom of the socket; now an empty (or below-minimum) sensor shows nothing at all.

### Stuck-Responding State Fix

* **No more frozen "responding" state** — fixed a bug where the avatar could get stuck in its responding (red, talking) visuals until the page was refreshed. Two related defects: (1) if a state update failed mid-apply, the card's internal bookkeeping said "everything is up to date" while the visuals were stale, so every future update was skipped; (2) with **Response Delay** configured, a pending delayed transition could fire even after the assistant had already moved on. The card now detects any desync on the next update and re-applies the correct state automatically — no refresh needed.
* **Self-healing updates** — every state delivery now verifies the applied animation state matches the entity state; a mismatch re-applies the state instead of being silently skipped. Animation failures are caught and retried on the next update instead of corrupting the pipeline.
* **Response Delay cleanup** — a pending delayed transition is now cancelled as soon as the entity leaves the responding state.
* **Re-attach safety** — when Home Assistant detaches and re-attaches the card (sections view, lazy loading, edit mode), the state caches are reset so the card re-evaluates the current entity states instead of trusting stale ones.

## 5.4.2

### Vertical Fill Symmetry Fix

* **Both sides now climb from the bottom** — fixed a bug in the 5.4.1 vertical fill where the right side of the ring filled *down from the top* instead of up from the bottom (at 25% one side stood a quarter up, the other a quarter down from the top). The dash pattern is now a 3-value `[L, gap, L]` array so both dashes start at bottom-center and the unlit gap always sits at the top; at 100% the dashes meet at top-center and the whole socket is lit.

## 5.4.1

### Vertical Progress Ring Fill

* **Vertical fill mode (default)** — the progress ring now fills both sides of the socket from the bottom up: at 50% both sides stand at exactly half height, at 100% the dashes meet at top-center and the whole socket is lit. The dash length is computed piecewise (cap arcs + straight sides) so the lit height is linear in the sensor percentage.
* **360° sweep still available** — turning the new **Vertical Fill (Bottom-Up)** toggle off restores the original clockwise sweep from the bottom-center. Dynamic/invert color and the smooth 0.6s dash glide work identically in both modes.

## 5.4.0

### Idle Progress Ring

* **Progress ring on the socket** — a new `progress_entity` sensor (0–100) drives a loading bar around the pill-shaped eye socket in idle mode. The ring starts at the bottom of the socket and fills clockwise; at 100% the entire socket is lit. The red responding-state ring is untouched — this is a separate, idle-only element.
* **Static or dynamic color** — by default the ring uses the idle pupil's amber shade. A **Dynamic Color** toggle sweeps green → yellow → red across the 0–100 scale, and an **Invert** toggle flips it to red → green.
* **Smooth updates** — percentage changes glide the dash fill (0.6s ease) instead of snapping; unavailable/unknown sensor states hide the ring; a percentage-only change while idle updates the ring in place without restarting any idle behaviors.

## 5.3.0

### The Dance Engine, rebuilt from the legacy choreography

* **Full legacy choreography port** — all 32 hand-written per-beat choreography blocks (8 per BPM tier) ported verbatim from the original card. Every phrase preserves the original arithmetic (sines, seeded jerks, pair-quantized tier-0 sway), so she dances exactly like the legacy card — now with the modular engine underneath.
* **Hard cuts at the bar boundary** — phrase switches land as deliberate, mechanical pose changes exactly on the beat instead of pre-blended mush. Direction reversals and style switches read as intentional.
* **Strobe fill** — during tier-3 (160+ BPM) phrases, her halo strobes red on the downbeat and white on off-beats, every beat.
* **Seeded pupil darts** — deterministic, reproducible dart accents per phrase, restored from the legacy card's idle/processing behavior.

### Smoothness & dynamics

* **Continuous energy envelope** — a cosine-interpolated 64-beat energy arc with a co-prime wobble (repeats only every 6208 beats) drives phrase selection, so the dance builds, peaks, and releases like a real performance instead of a flat loop.
* **Choreographed handoffs** — the last beats of every phrase glide toward the next phrase's entry pose via `flowBlend` crossfades, so style switches read as transitions, not teleports.
* **In-place BPM retune** — when the track's BPM changes within the same personality tier, she retunes her beat timing silently mid-dance without restarting. Cross-tier changes trigger a full, clean restart.
* **Anti-metronome guarantees** — the verify suite asserts no plateaus over 4096-beat walks and bounded drift, so the dance never looks looped.

### Fixes

* **Pupil-escape fix** — at high BPM, tier-3 darts could translate the iris outside the eye socket. Two layers of defense: a `socketClip` clipPath on a static wrapper group (geometric guarantee) and a per-tier radial `DART_MAX` clamp `[3, 6, 6, 9]` px (physical plausibility). The pupil can never leave the socket again.

### Tooling

* **Standalone demo.html** — the card bundle is now inlined into `demo.html` at build time, so the demo runs offline via double-click (`file://`) with no CORS issues.
* **New verification scripts** — `scripts/verify_dance_smoothness.mjs` (clamps, no-repeat reachability, hard-cut, energy continuity, acceptance checks A1–A6) and `scripts/verify_bop_tail.mjs` (bop freeze/resume + retune), both wired into CI.