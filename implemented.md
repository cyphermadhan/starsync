# Implementation Log

## [2026-10-01] — Redesign the daily email: content structure, voice, and visuals

- **What:** Rewrote the OpenAI prompt and Resend template for the daily-send worker to match a
  detailed structural brief (hook, core energy, work & productivity, love & relationships, social
  dynamics, do's/don'ts, closing quote; subject "Today's Sync"), then pixel-matched the visuals to
  a Figma spec with icon assets.
- **Files:** `workers/daily-send/src/openai.ts`, `workers/daily-send/src/resend.ts`,
  `workers/daily-send/src/index.ts`, `public/email/*` (new icon/logo assets).
- **Details:**
  - Element framing (Fire/Earth/Air/Water) now glosses each trait inline instead of using bare
    jargon the reader won't recognize.
  - Greeting/date are now IST-aware and time-of-day specific (was hardcoded "Good morning" off UTC).
  - Logo dark-mode handling: abandoned CSS-driven light/dark swap after confirming Gmail Android
    ignores `prefers-color-scheme` entirely — switched to a single asset with the light/dark chip
    baked directly into the PNG, which is correct regardless of client dark-mode support.
  - Dropped an attempted `@font-face` embed of Google Sans Flex: Gmail (web + app) never loads
    custom web fonts in email, confirmed against a comparable real project's own design notes.
    Falls back to each platform's system font instead.

## [2026-09-30] — Add particle-reveal background, real logo/font, and full card redesign

- **What:** Added a background photo (`public/hero-bg.webp`) with a WebGL2 "particle reveal" cursor
  effect (`src/lib/particle-reveal.ts`, adapted from Canvas UI's component to sample a plain image
  texture instead of their experimental Chrome-only "html-in-canvas" capture API, so it works in any
  WebGL2 browser). Then redid the onboarding page per a supplied Figma wireframe: everything now lives
  inside one card (logo + Privacy row, heading, form, pricing note, consent, button, footnote), using
  the real StarSync logo and "Google Sans Flex" site-wide, plus a segmented DD/MM/YYYY and HH/MM/AM-PM
  input style for date/time fields instead of native date/time pickers.
- **Files:** `src/lib/particle-reveal.ts` (new), `src/pages/index.astro` (full rewrite), `src/layouts/Base.astro`
  (`hideTopbar`/`hideFooter` props, new logo, new font links), `public/starsync-logo.svg`,
  `public/hero-bg.webp`.
- **Details:**
  - Two stacking bugs fixed along the way: a `position:fixed` background layer with `z-index: -1`
    painted below the page's own `background-image` (invisible), and with `z-index: 0` painted above
    all non-positioned static content regardless of DOM order (covered everything) — non-positioned
    content and positioned content are different painting steps per the CSS spec, so z-index alone
    can't order them; fixed by moving the background into a named Astro slot as a true sibling of a
    `position: relative; z-index: 1` page shell.
  - Logo SVG originally used `fill="currentColor"`, which doesn't work through `<img src>` (no CSS
    color inheritance across that boundary) — hardcoded the fill to the site's light text color
    instead of leaving an invisible-on-dark-background bug.
  - Segmented date/time inputs reconstruct into the same `dob`/`tob`/`sendTime` string formats
    `/api/signup` already expects, so no backend changes were needed.
  - Verified with `astro check` + `astro build` only (both clean) — no browser check, per the user's
    standing preference to review UI changes himself.

## [2026-09-30] — Replace ProKerala astrology API with in-process Vedic chart calculation

- **What:** Dropped the ProKerala astrology API in favor of computing Rasi/Nakshatra/pada ourselves in `src/lib/vedic.ts`, using the `astronomia` npm package (pure-JS Meeus lunar theory, no data files/external calls) plus an approximate Lahiri ayanamsa. Reasoning: the content is fun/affirmation-style, not a professional-accuracy claim, so a $19–99/mo credit-metered astrology API wasn't worth it — especially since its pricing was for a *daily horoscope* endpoint we never intended to call per day; our actual need (one birth-chart lookup per signup) wasn't even priced on the page we checked.
- **Files:** added `src/lib/vedic.ts`, `src/types/astronomia.d.ts`; removed `src/lib/prokerala.ts`; updated `src/pages/api/signup.ts`, `src/lib/geocoding.ts` (added `toUtcDate`), `db/schema.sql` (dropped unused `lagna` column), `src/env.d.ts`, `wrangler.toml`, `.dev.vars.example`, `src/pages/privacy.astro`, `plan.md`.
- **Details:**
  - Sanity-checked the moon-position math against known dates in Node before wiring it in; `astro check` and `astro build` both clean afterward.
  - Side benefit: one fewer third party ever touches raw birth data now (removed from the privacy page's "who else touches your data" list) — only Razorpay, Resend, and Anthropic remain.
  - Signup's astrology step now needs zero API keys/accounts at all; only Razorpay + Cloudflare credentials are still required to run signup end-to-end.
  - Caveat kept in `plan.md`: the ayanamsa is an approximation, so results near a sign boundary could occasionally be off by one sign — acceptable given the "fun, not a real astrologer" framing.

## [2026-09-30] — StarSync onboarding, privacy, and unsubscribe pages + signup/unsubscribe API

- **What:** Scaffolded the StarSync Astro/Cloudflare project and built the onboarding page, privacy page, unsubscribe confirmation page, and working `/api/signup` + `/api/unsubscribe` server logic (validation, AES-256-GCM encryption, geocoding + timezone resolution, ProKerala chart lookup, Razorpay customer/subscription creation, D1 writes).
- **Files:** `src/pages/index.astro`, `src/pages/privacy.astro`, `src/pages/unsubscribed.astro`, `src/pages/api/signup.ts`, `src/pages/api/unsubscribe.ts`, `src/lib/{encryption,geocoding,prokerala,razorpay}.ts`, `db/schema.sql`, `wrangler.toml`, `.dev.vars.example`, `plan.md`.
- **Details:**
  - Verified with `astro check` (0 errors) and `astro build` (clean), plus a visual pass in a real browser at desktop and mobile widths.
  - Geocoding (place-of-birth → lat/lng → IANA timezone → UTC offset) uses only free/keyless services (Open-Meteo + `tz-lookup` + `Intl`), so ProKerala + Razorpay are the only paid integrations left to key in.
  - Not yet built (needs your Cloudflare/Razorpay/ProKerala/Resend/Anthropic accounts first): Razorpay webhook handler, the cron + queue daily-send pipeline, Claude prompt tuning, Resend templates, actual deployment/DNS — see `plan.md` for the full roadmap.
