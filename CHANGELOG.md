# Changelog

All notable changes to **IG TOOLs - AvidKiya** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [4.4.1] - 2026-07-24

### Fixed — resilient own-profile lookup (kills the `(empty-profile)` error)
- `getOwnProfile()` no longer throws `empty-profile` when Instagram answers 200-but-no-`user` (temporary checkpoint/feedback/AB-test). It now walks a fallback chain: `i.instagram.com users/info` → same path on `www.instagram.com` → `web_profile_info` by username, then **degrades gracefully** — scan & queue keep working, counters show `—`, and a one-time warning toast explains it (details land in the console, including IG's own `message`).
- Web panel gains a local diagnostics endpoint **`/api/debug/profile`** (127.0.0.1 only) returning raw snippets of both profile endpoints for troubleshooting.
- New test suite `tests-igtools/profile-chain-test.mjs` (5 mocked scenarios: primary ok, checkpoint fallback, username fallback, full degrade, logged-out auth throw).

## [4.4.0] - 2026-07-24

### Added — feature parity: the extension gets the full AI copilot (matches Web v1.2.x)
- **3-mode working state** (`Settings → AI assistant`) now also in the extension: **Manual** (background automations — incl. the marketing alarm poller — pause), **Automatic** (default, as before), **AI** (Ollama-powered helpers).
- **Ollama straight from the extension**: new shared module `lib/ai-local.js` (prompts + robust parsers + fetch client) talks to `http://127.0.0.1:11434` from the extension page; new `host_permissions` for `127.0.0.1:11434` / `localhost:11434`. Same key schema (`ai_settings`) as the web panel — configure once, both honor it.
- **AI features in the extension**: smart DM-draft modal per marketing alert, intent auto-classification of new hits inside the background poller (`classifyHits`), and the ⚡ **Turbo Queue** with fresh-Explore posts — read directly via the browser session (new `fetchFreshExplore`/`collectExploreItems` in `lib/instagram-api.js`, replacing the web-only server endpoint).
- Coach tab in the extension now also lists **fresh Explore posts (<24h)** alongside its on-page overlay; the overlay remains the in-place coach on instagram.com.
- **Unchanged by design**: the copilot only drafts/suggests; comments & DMs are still always sent by you. New tests: `tests-igtools/ai-local-test.mjs` (28 checks) + updated turbo/i18n/dom/regression suites — all green.

## [4.3.1] - 2026-07-24

### Added — ⚡ Turbo Queue (web panel, Web v1.2.0)
- Coach tab gains a hidden `#turboCard` (web-only): prepares comment texts for up to 30 fresh Explore posts — either **rotating emojis from your own pool** (e.g. 🧟‍♂️, 🧟‍♂️🔥, 🧟‍♂️❤️) or **AI ideas from captions** — and lines them up one-by-one with a persistent, resumable queue (`turbo_queue` in local storage).
- Per item: editable textarea → **Copy & open post** → user pastes and sends by hand → **Done ➜ next**. ~3 seconds per comment at full human control; no auto-sending of any kind.
- New shared `turbo.*` i18n section (fa/en), Liquid-Glass styles for the runner card. Extension behavior unchanged (card stays hidden outside the local web panel).

## [4.3.0] - 2026-07-24
## [4.3.0] - 2026-07-24

### Added — AI-assistant hooks for the local web panel (Web v1.1.0)
- New settings key `assistantMode`: **manual | auto | ai** (extension keeps behaving as `auto`; the 3-mode card renders only in the local web panel).
- New shared i18n section `ai.*` (fa/en), Liquid-Glass styles for AI elements (idea chips, intent badge, thinking sweep), and hidden `#aiCard` settings markup that the web panel activates.
- `dashboard.js`: in web mode — per-alert **smart DM draft** modal (Ollama) and per-fresh-post **comment ideas** (3 tap-to-copy chips), all generation-only; sending stays manual. No behavior change inside the browser extension.

## [4.2.0] - 2026-07-22

## [4.2.0] - 2026-07-22

### Changed
- **GlassSelect**: every native `<select>` popup (language, theme, filters, sort, history filter) is replaced by a custom Liquid-Glass dropdown — frosted list panel, animated chevron, selected-option glass checkmark. The real `<select>` remains the state owner so all existing logic, `change` events and programmatic value sets work unchanged. Full a11y: listbox roles, arrow keys, Enter/Esc/Tab.
- **Livelier liquid backdrop**: two counter-moving aurora layers + a slow diagonal light sweep; still disabled under `prefers-reduced-motion`.

## [4.1.0] - 2026-07-22

### Changed — full **Liquid Glass** redesign
- New design system: translucent layers with `backdrop-filter: blur + saturate`, 1px specular top-edge highlights, layered depth shadows, and a slow-moving **aurora backdrop** that the glass refracts.
- Floating sticky glass topbar; tabs became a frosted segmented pill-bar; rounded pill buttons with gloss + specular sweep on primary actions; glass inputs, tables, toasts, modals (with frosted dim backdrop), sticky glass actions bar.
- Tokens kept on brand: Dark `#171717` / `#21F1A8`, Light `#F0EDE4` / `#004741`.
- Coach overlay on instagram.com redesigned to match (dark frosted glass).
- Accessibility: `@supports` fallback without backdrop-filter, `prefers-contrast: more` borders, `prefers-reduced-motion` disables aurora + animations. No color contrast regressions.
- `docs/preview.html` rebuilt as a v4 Liquid-Glass showcase (both themes, marketing alert, coach widget).

## [4.0.0] - 2026-07-22

### Added — the app becomes a toolbox (renamed to **IG TOOLs - AvidKiya**)
- **📣 Comment Marketing tab**: watch YOUR OWN posts for keyword comments. Polls one post per minute via `chrome.alarms` (round-robin, read-only, 15-min auto-cooldown on rate limits). Keyword hits create inbox alerts + Chrome notifications + toolbar badge. One-click DM draft (template with `{user}`/`{keyword}`/`{link}`) — clipboard copy + Direct opens, **sending is always manual**. Local shortcode→media-id decoding (no extra requests), done/new status per alert.
- **🧠 Commenting Coach tab + overlay**: manual engagement sessions with a daily goal. On instagram.com a small coach widget flags whether the open post is **fresh (<24h)** or old, cycles a Persian/English idea bank (built-in + custom ideas), and auto-detects when YOU post a comment (author = your username from Settings) to count it. Stats: today/goal, week total, day streak, fresh share, recent comment log. 🏆 goal notification. **It never types, clicks or posts — pure coach.**
- Settings: new **Instagram username** field (coach recognition, stored locally).
- New modules: `lib/marketing.js`, `lib/coach.js`; new files: `content.js`, `assets/coach-overlay.css`; new permissions: `alarms`, `notifications`.

### Unchanged by design
- Unfollow manager identical to 3.0.0; all privacy guarantees hold. No auto-commenting, no auto-DM, no auto-liking anywhere in this extension.

## [3.0.0] - 2026-07-22

### Added
- Full rewrite on **Manifest V3** with a modular ES-Modules architecture (`lib/config|instagram-api|storage|queue|i18n|export|theme`).
- **Live scan engine**: step indicator, pages counter, real-time following/follower counters, temporary non-follower count, live result preview, elapsed timer and true **Cancel Scan** (AbortController).
- **Diff engine**: snapshot history (max 20) with new non-followers / new followers estimate / left-the-list per scan, plus internal SVG trend chart.
- Complete **non-follower workspace**: search, private/public, verified, bio, picture, protection filters, follower/following ranges, follower buckets (under 1K … 5K+), sorting, incremental rendering for huge lists.
- **Smart select** with hard guarantee: Never-Unfollow users are never bulk-selected.
- **Protected lists**: Favorites & Never-Unfollow with move/remove, search, CSV/JSON export and **validated JSON import** (invalid entries reported to the user).
- **Human Mode** (on by default): randomized delays, natural jitter, batch pauses, daily limit, instant stop on 429 / Action Block with suggested cooldown.
- **Persistent unfollow queue** in `chrome.storage.local`: survives dashboard closing, offers Resume only after explicit user confirmation — never auto-continues.
- Professional **confirmation modal** before every run (counts, excluded protected users, followers distribution, preset, delay range, ETA, risk warning).
- **Activity** tab: scan history table, per-scan diffs, unfollow history with filters, CSV/JSON export.
- Bilingual UI (**Persian RTL default / English**) with local **Vazirmatn** webfonts, **Dark (`#171717`/`#21F1A8`) / Light (`#F0EDE4`/`#004741`) / System** themes.
- Toasts, skeleton-friendly states, keyboard-navigable tabs, aria labels, focus-visible rings, `prefers-reduced-motion` support.
- Original brand assets: camera × letter “A” mark in 16/32/48/128/256 PNG + SVG logo (no copied Instagram assets).
- Graceful profile-picture fallback avatars (no proxies, no broken-image icons).
- Structured error handling for 401 / 403 / 429 / timeout / action-block / logged-out states.

### Security & Privacy
- All data stored exclusively in `chrome.storage.local`; nothing is transmitted to any server.
- No `eval`, no remote code, no CDN scripts, no external tracking, no paywall.

[3.0.0]: https://github.com/avidkiya
