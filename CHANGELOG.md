# Changelog — AXiDOS Avatar Card

All notable changes to this project are documented in this file.

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