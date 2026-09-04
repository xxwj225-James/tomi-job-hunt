# Privacy

Tomi-Job-Hunt is built on one principle: **your job-hunting data is yours,
and it stays on your machine.**

## What stays local

- Your resume (`resume.md`) and preferences (`preference.json`)
- Browsing history and which jobs you viewed/scored
- All generated output (pitches, tailored resumes, match reports)
- Your configuration (`~/.tomi-job-hunt/config.json`)

The Core service binds to `127.0.0.1` only. It does not listen on any network
interface and has no cloud component.

## What leaves your machine

Only the minimum needed to call the LLM API you configured:

- The job description (JD) text you choose to process
- The prompt template + relevant resume excerpts

This data goes **directly** from your machine to the LLM provider
(Anthropic / DeepSeek / Qwen) — never through any Tomi-Job-Hunt server.
No intermediate service exists to route through.

## What we never do

- No crash reporting, no user accounts, no login, no cloud sync, no ads, no tracking pixels
- Telemetry is **opt-in and OFF by default** — see the optional section below

## Optional opt-in usage counts (default OFF)

TomiHunt does not collect anything unless you switch on **帮助改进 TomiHunt**
in the Agent's Settings. When enabled it records — entirely on your machine —
how many times each feature is used per day (feature-name → count) and uploads
that day's aggregate once the day closes.

- **Consent gate**: every counter is a hard no-op while the switch is OFF; no
  telemetry file is even created. Turning the switch OFF immediately erases all
  counters and stops the flusher.
- **What is sent**: a random `installId` (generated on first opt-in), the UTC
  day, platform, app + core versions, and `{ feature: count }` totals. It never
  contains resumes, JD text, chat content, or any content-bearing field — pure
  counts only.
- **Where it goes**: `collectorUrl` — by default a tomatovector.com endpoint,
  overridable via `telemetry.json` or the `TOMI_TELEMETRY_URL` env var if you
  self-host your own collector.
- **Audit**: inspect `~/.tomi-job-hunt/telemetry.json`; the only outbound
  request is one small POST per closed day. Full detail:
  [telemetry.md](telemetry.md).

## API keys

- API keys are read from the `ANTHROPIC_API_KEY` environment variable or
  `~/.tomi-job-hunt/config.json` — never hardcoded, never committed
  (`.gitignore` excludes `.env` and local config files).
- If you use a proxy or a shared machine, prefer the environment variable
  approach and clear your shell history after export.

## Can't read the code?

If you don't trust a claim, read the code — the whole point of open source is
that you can verify it. `core/src/` is small and deliberately dependency-light.
