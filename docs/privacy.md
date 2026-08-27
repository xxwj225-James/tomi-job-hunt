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

- No telemetry, no analytics, no crash reporting
- No user accounts, no login, no cloud sync
- No ads, no tracking pixels

## API keys

- API keys are read from the `ANTHROPIC_API_KEY` environment variable or
  `~/.tomi-job-hunt/config.json` — never hardcoded, never committed
  (`.gitignore` excludes `.env` and local config files).
- If you use a proxy or a shared machine, prefer the environment variable
  approach and clear your shell history after export.

## Can't read the code?

If you don't trust a claim, read the code — the source is published precisely so it can be
that you can verify it. `core/src/` is small and deliberately dependency-light.
