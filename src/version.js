/**
 * version.js — Single source of truth for the card build version.
 *
 * The perf HUD echoes this string so a tester on a device without developer
 * tools (Android WebView / View Assist Companion App) can verify WHICH build
 * the browser actually loaded. HA serves card resources at a stable
 * /hacsfiles/... URL with no cache-busting, so browsers and Android WebView
 * hold the file aggressively — an in-place overwrite can leave every client
 * silently on the old build, a failure indistinguishable from "fix didn't
 * work". The HUD build line ends that ambiguity: read it on the tablet and
 * you know exactly what is running.
 *
 * Bump this together with package.json / package-lock.json on every release.
 */
export const CARD_VERSION = '5.7.0-beta.1';