[![GitHub Release](https://img.shields.io/github/v/release/Axildor/AXiDOS-Avatar-Card?style=flat-square)](https://github.com/Axildor/AXiDOS-Avatar-Card/releases)
[![HACS Status](https://img.shields.io/badge/HACS-Custom-orange.svg?style=flat-square)](https://github.com/hacs/integration)
[![Build](https://img.shields.io/github/actions/workflow/status/Axildor/AXiDOS-Avatar-Card/build.yml?branch=main&label=Build&style=flat-square)](https://github.com/Axildor/AXiDOS-Avatar-Card/actions/workflows/build.yml)
[![Buy me a tea](https://img.shields.io/badge/Buy_me_a_tea-☕-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/axildor)

# AXiDOS Avatar Card for Home Assistant

> Inspired by GLaDOS from Portal. Not affiliated with, endorsed, or sponsored by Valve Corporation.

<img width="954" height="439" alt="image" src="https://github.com/user-attachments/assets/8cf8be88-e375-46d2-9fb8-7db2061b308c" />

A highly responsive, fully animated AXiDOS custom card for Home Assistant. Built using zero-dependency CSS and SVG transitions, this card brings AXiDOS to life on your dashboard as a visual interface for your Voice Assistant satellites.

She tracks your voice assistant's state in real-time, features a randomized idle behavior engine, and includes a **dynamic, mathematically-driven dance engine** that syncs perfectly to your music.

## ✨ Features

* **Real-time State Tracking:** Seamlessly transitions between Idle, Listening (Blue), Processing (Orange/Pulsing), and Responding (Red/Talking).
* **Organic Idle Engine:** Uses a weighted randomizer to cycle through various idle animations (swaying, looking around, glitching, getting bored) so she never looks robotic or looped.
* **Performance Optimized:** Uses GPU-accelerated CSS `transform` and `opacity` properties, with bloom effects pre-baked as SVG gradients instead of runtime filters. Internal state-caching and garbage collection ensure zero memory leaks and negligible CPU drain.
* **Visual UI Editor:** Fully supports Home Assistant's visual card editor. No YAML configuration required!
* **Response Delay Timer:** Configurable delay to keep her in the "Processing" state a little longer before she starts talking, giving your TTS engine time to catch up.

## 🪩 The Dynamic Dance Engine

When your configured media player starts playing, AXiDOS enters a dedicated **Spotify Green** dance mode. 

Instead of a basic looped animation, she features a **Phrase-Graph Choreography Engine** that actively reads the tempo of your music and dances in **16-beat phrases** — named moves like *pendulum sway*, *dip & loom*, and *servo stutter* that mimic how a suspended robotic head would actually groove. A transition graph chains phrases into each other (no jarring style teleports), and a 64-beat **energy arc** gives the dance verse/chorus dynamics: she grooves, builds, peaks, and releases like she's actually performing the song.

Her movement is built from composable layers, the same way a real puppeteer works:
* **Compositor Moves** — every pose change is a single declarative CSS transition that the browser interpolates on the GPU, so the dance stays butter-smooth even on modest tablet hardware. Snappy moves land inside the beat with an overshoot curve; flowing moves glide across beats.
* **Physical Laws** — every move obeys her anatomy: she *dips into* the downbeat (gravity), her head swings in an arc rather than sliding sideways (pendulum), her torso swivel lags behind the head like a slow groove, and direction reversals land exactly on the beat (mechanical precision).
* **Choreographed Handoffs** — the last 3 beats of every phrase glide toward the next phrase's entry pose, so style switches read as deliberate transitions, not pose teleports.
* **Breathing** — her bellows compresses on the downbeat dip and releases on the rise — she breathes *with* the beat.

Her personality shifts depending on the speed of the music:
* **Chill & Soulful (< 90 BPM):** Fluid, heavily relaxed glides — *pendulum sway*, *crane sweep*, *slow loom* — with heavy eyelids.
* **Groovy & Pop (90 - 124 BPM):** Confident and bouncy — *metronome rock*, *dip & nod*, *swivel groove*, and a *bounce build* that grows into the chorus.
* **Upbeat & Club (125 - 159 BPM):** Sharp, high-energy snaps — *dip & loom*, *snap swivel*, *pendulum pump*, and a *peak stomp* for the drop.
* **Intense & Hardcore (160+ BPM):** Aggressive mechanical assault — *violent pendulum*, *servo stutter* (quantized glitch-groove), *loom assault*, and *stomp cycle*.

### ⚠️ Prerequisite for Dancing
For AXiDOS to sync her movements to the beat, **she needs to know the BPM of the currently playing song**. 

You will need an integration that provides a BPM sensor for your media player. I highly recommend using **[SongBPM-26](https://github.com/adix992/SongBPM-26)**, an integration specifically created to pull real-time track BPMs for this exact purpose.

## 📦 Installation

### HACS (Recommended)
1. Open HACS in your Home Assistant instance.
2. Go to **Frontend** > Top right menu > **Custom repositories**.
3. Add the URL to this repository and select **Lovelace** as the category.
4. Click Install and reload your browser.

### Manual
1. Download `axidos-card.js` from the latest release.
2. Copy it into your `config/www/` directory.
3. Go to **Settings** > **Dashboards** > **Top right menu** > **Resources**.
4. Add `/local/axidos-card.js` as a JavaScript Module.

## ⚙️ Configuration

You can easily configure the card using the Home Assistant visual editor simply by clicking "Add Card" and searching for "AXiDOS Avatar Card". The visual editor uses Home Assistant's native form components (entity pickers, sliders, toggles, and the standard action editor), so it looks and behaves like a first-party card.

Alternatively, you can use YAML:

```yaml
type: custom:axidos-card
entity: assist_satellite.living_room
media_entity: media_player.spotify
bpm_entity: sensor.universal_music_bpm
respond_delay: 2.5
zoom: 85 # Scale percentage of the SVG model inside the card. Default is 85. Above 100 the card grows to keep the model fully visible.
tap_action:
  action: more-info # Standard HA action: more-info, toggle, navigate, call-service, etc.
```

## Configuration Variables

| Name | Type | Requirement | Description |
| :--- | :--- | :--- | :--- |
| `type` | string | **Required** | Must be `custom:axidos-card`. |
| `entity` | string | **Required** | The entity ID of your voice assistant satellite (e.g., `assist_satellite...`). |
| `media_entity` | string | Optional | The entity ID of your media player. Triggers the dance state when `playing`. |
| `bpm_entity` | string | Optional | The entity ID of the sensor providing the current song's BPM (requires [SongBPM-26](https://github.com/adix992/SongBPM-26)). Defaults to 120 if missing. |
| `respond_delay` | number | Optional | Number of seconds to wait before changing from Processing (Orange) to Responding (Red). Useful if your TTS has a slight delay. Default is `0`. |
| `zoom` | number | Optional | Scale percentage of the SVG model inside the card. Default is `85`. Above 100 the card slot grows with the model (rows AND columns) so the model actually enlarges and stays fully visible. |
| `transparent_bg` | boolean | Optional | Removes the card background, shadow, and border. Default is `false`. |
| `tap_enabled` | boolean | Optional | Enables the tap-to-bop interaction. Default is `true`. |
| `tap_action` | object | Optional | Standard HA action (`more-info`, `toggle`, `navigate`, `call-service`, etc.) fired on tap. Default is `{action: "none"}`. |
| `tap_speed` | number | Optional | Bop animation speed, `0.1` (slow) – `2.0` (fast). Default is `0.5`. |
| `tap_bounces` | number | Optional | Rebound oscillations before settling, `1`–`20`. Default is `5`. |
| `tap_intensity` | number | Optional | How far the head pulls back, `0.5`–`2`. Default is `1.0`. |
| `tap_bop_resume` | number | Optional | Point in the bop tail (fraction of the actual peak bounce) where the paused background resumes, `0.05`–`0.8`. Default is `0.3`. Tapping freezes all in-flight head motion (idle poses and dance moves) so the bop owns the head exclusively — the beat clock keeps running, so the dance stays synced — and the background melds back in at this point while the last small bounces are still finishing. The peak is measured once at the top of the first bounce, so the resume point is exact and the slider is honest. Re-tapping mid-bop always amplifies the bounce (energy-add kick, never dampens, no matter where in the swing you tap) and re-arms the meld point from the new bounce's peak. |

## 🎬 Demo & Debug Studio

Open `demo.html` in a browser (serve the repo root, e.g. `npx serve .` or `python3 -m http.server`) to run the card outside Home Assistant with a mock `hass` object. It drives the exact production code path (`set hass` → state diffing → `applyState`), so what you see is what your dashboard gets.

Use it to:
* **Preview all states** — Idle / Listening / Processing / Responding / Dancing buttons (or keys `1`–`5`), plus a BPM slider to test the dance engine at any tempo.
* **Take screenshots** — switch backdrops between HA Dark, HA Light, and a transparent checkerboard; press `H` for clean mode that hides all UI.
* **Record GIFs** — the auto-cycle button walks through every state on a timer for a one-pass capture.
* **Tweak configuration live** — the ⚙️ **Card Config** popup mirrors the HA visual editor (entities, response delay, zoom, transparent background, and all tap-physics options) and applies changes through `setConfig()`.

## 🧑‍💻 Development

The card source lives in small, focused ES modules under `src/` and is bundled into the single `axidos-card.js` file that HACS distributes.

| Module | Responsibility |
| :--- | :--- |
| `src/index.js` | Entry point: custom element registration + card picker entry |
| `src/axidos-card.js` | Card lifecycle, config, hass state diffing, tap handlers |
| `src/editor.js` | Declarative `getConfigForm()` schema for HA's native visual editor |
| `src/config.js` | Config sanitization/clamping (pure functions) |
| `src/state-mapper.js` | Voice/media/BPM state mapping (pure functions) |
| `src/template.js` | CSS + inline SVG markup (the AXiDOS model artwork) |
| `src/animator.js` | Element refs, motion primitives, timer/RAF registry |
| `src/states.js` | Per-state visual setup (idle/dancing/listening/processing/responding) |
| `src/behaviors/idle.js` | Weighted idle behaviors, lid loop, pupil darting |
| `src/behaviors/choreography.js` | Phrase-graph choreography data + walker (pure, no DOM) |
| `src/behaviors/dance.js` | BPM-synced dance execution engine (phrase driver) |
| `src/behaviors/talk.js` | Responding-state talk animation |
| `src/behaviors/bop.js` | Spring-physics tap bop |
| `src/behaviors/spring.js` | Damped-oscillator spring physics (tap bop) |

### Building

```bash
npm install
npm run build    # bundles src/ -> axidos-card.js
npm run verify   # build + syntax check
```

A GitHub Actions workflow automatically rebuilds `axidos-card.js` on every push to `main`, so the committed bundle always matches the source. When contributing, edit files under `src/` only — never hand-edit `axidos-card.js`.

## 🛠️ Tech Stack & Optimization

This card is completely self-contained. It uses no external image files (everything is dynamically drawn via inline SVG), and all lighting blooms, shadows, and metallic reflections are calculated natively by the browser's SVG rendering engine.

### Performance Notes:

* **Zero-Drift Sync:** Uses `performance.now()` high-resolution timestamps to ensure dance moves stay locked to the beat during long playback sessions.
* **Firehose Gatekeeping:** Implements state-caching to ensure the card only recalculates animations when your tracked entities change, ignoring irrelevant Home Assistant state traffic.
* **Resource Management:** Automatically destroys all active timers and animation loops when the card is removed from the DOM to prevent memory leaks.

---

## ☕ Support the Project

I'm a solo developer on disability building Home Assistant integrations
and add-ons independently. Your support keeps servers online, API quotas
funded, and the black tea brewing while I debug JavaScript.

If this card is useful to you, there's no obligation — but any support
is highly appreciated.

[![Buy me a tea](https://img.shields.io/badge/Buy_me_a_tea-on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/axildor)

---

## License

MIT
