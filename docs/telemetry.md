# Optional anonymous usage telemetry

TomiHunt helps no one if its author can't tell how the tool is (or isn't)
being used. But a privacy-first product can't phone home silently — so usage
data is **strictly opt-in, OFF by default, and limited to anonymous feature
counts**. If you never touch the switch, nothing is ever recorded and no
request ever leaves your machine.

## The switch

Settings → **应用 → 帮助改进 TomiHunt** (Agent UI). Every counter is a hard
no-op while it is OFF: `count()` / `markDaily()` return immediately, no
`telemetry.json` is created, and there is zero network traffic. Turning it OFF
again erases every counter and stops the periodic flusher.

## What is collected

A per-day tally of *how many times each feature ran successfully*, keyed by the
random `installId` generated on your first opt-in:

| Event              | Meaning                                              | When (success path only)      |
|--------------------|------------------------------------------------------|-------------------------------|
| `app_start`        | Desktop Agent window ran today (presence, max 1/day) | renderer presence call        |
| `ext_online`       | Headless browser extension connected today (≤1/day)  | `/agent` WS agent hello       |
| `jd_capture`       | A JD was stored                                     | POST `/v1/jd/capture`         |
| `greeting`         | Greeting pitch generated                            | POST `/v1/greeting`           |
| `match`            | Match score produced                                | POST `/v1/match`              |
| `semantic_search`  | Semantic search ran                                 | POST `/v1/jd/semantic-search` |
| `resume_tailor`    | Tailored resume produced                            | POST `/v1/resume/tailor`      |
| `resume_export`    | Tailored resume exported (md or doc)                | POST `/v1/resume/export`      |
| `resume_verify`    | Fact-check ran on a tailored resume                 | POST `/v1/resume/verify`      |
| `interview_prep`   | Interview questions generated                       | POST `/v1/interview-prep`     |
| `mock_turn`        | One mock-interview turn answered                    | POST `/v1/mock/turn`          |
| `board_add`        | A job was added to the tracker board                | POST `/v1/board`              |
| `reply`            | A smart reply was drafted                           | POST `/v1/reply`              |
| `hunt_companies`   | Reverse-job-hunt target search ran                  | POST `/v1/hunt/companies`     |
| `cold_email`       | A cold outreach email was drafted                   | POST `/v1/hunt/cold-email`    |

**The payload never contains resumes, JD text, chat content, HR names, or any
content-bearing field.** It is pure `{ feature: count }` numbers plus an
`installId`, UTC day, platform and versions. Failed LLM calls are not counted.

## When data leaves your machine

Only while the switch is ON, and only **after a day closes**: counters roll
over at UTC midnight into a pending queue, and one small POST per closed day is
sent by the flusher (every 6h while running, plus on startup if something is
pending, plus a best-effort attempt at shutdown). Each `(installId, day)` is
sent at most once — a collector can append, not sum. If the collector is
unreachable the day stays pending and is retried later; data can arrive up to
~a day late, which is fine for product analytics.

## Where it goes

`GET /v1/usage` reports the active collector URL. By default:

```
https://tomatovector.com/api/tomihunt-usage
```

Override it (self-hosted collector) with either:

- `TOMI_TELEMETRY_URL` env var — wins over everything; or
- the `collectorUrl` field inside `~/.tomi-job-hunt/telemetry.json`.

## How to audit it

Open `~/.tomi-job-hunt/telemetry.json`. It holds your `installId`, consent
flag, the open day's counters and any closed days awaiting upload. The only
outbound request this feature ever makes is one `POST` per closed day to the
collector URL above. The reference collector for self-hosters is
[`cloudflare/worker.js`](../cloudflare/worker.js) (`POST /usage`), which writes
daily totals to R2.

## Extension boundary

- **Extension-only mode (direct)**: the extension talks straight to your LLM
  provider and never touches the local Core service, so nothing is counted and
  there is no extension-side toggle (v1). This is documented so you aren't
  surprised that extension activity can be invisible.
- **Extension + Agent (online)**: extension actions arrive at the Core service,
  so they *are* counted — but only while the **host machine's** switch is ON.
  The extension never collects on its own.

## Honest limitations

- Because telemetry defaults to OFF, early data is sparse: "how many users"
  only reflects people who opted in.
- `installId` identifies a *machine* (per config dir), not a person. Reinstalls
  or shared machines skew a naive daily-active count.
- The collector endpoint is implemented on the tomatovector.com server
  (`POST /api/tomihunt-usage` in `tomatolite-website/server.js`, isolated
  `tomihunt_usage` table + admin "TomiHunt 用量" view). Data only arrives once
  that server actually runs the new code (owner deploy/restart); until then the
  flusher quietly no-ops. The Cloudflare worker below remains a reference
  self-host alternative.
