# Architecture

## Overview

```
┌───────────────────────────────────────────────────────────┐
│                 Chrome / Edge browser extension           │
│  (Boss直聘 / 猎聘 DOM extraction · list highlighting ·    │
│   one-click fill into chat box)                           │
└─────────────────────────────┬─────────────────────────────┘
                              │ Localhost HTTP / WebSocket
                              ▼
┌───────────────────────────────────────────────────────────┐
│                Local Core CLI (based on Claude Code)      │
│  ┌───────────────┐   ┌───────────────┐   ┌──────────────┐ │
│  │ Resume/pref   │   │ Match scoring │   │ Pitch/CV     │ │
│  │ parsing       │   │ engine        │   │ generation   │ │
│  └───────────────┘   └───────────────┘   └──────────────┘ │
│                             │                             │
│   User local data (Markdown/JSON) + LLM (Claude/DeepSeek) │
└───────────────────────────────────────────────────────────┘
```

## Core service internals

```
src/
├── index.ts          entry: config → logger → HTTP + WS → graceful shutdown
├── types.ts          shared types (ChatMessage, LLMConfig, WsEvent, ...)
├── config.ts         loads ~/.tomi-job-hunt/config.json, env overrides
├── logger.ts         leveled logger with per-job prefixes
├── queue.ts          concurrency-limited task queue (LLM calls)
├── http/server.ts    Hono app: GET /health, POST /v1/chat (127.0.0.1 only)
├── ws/server.ts      WebSocket /ws: job lifecycle events broadcast
└── llm/
    ├── chat-provider.ts   ChatProvider interface + ChatProviderError
    ├── factory.ts         createChatProvider(config) dispatch
    ├── claude-code.ts     Claude Code agent-sdk (async-generator query)
    ├── claude-api.ts      Anthropic Messages API (@anthropic-ai/sdk)
    └── openai-compat.ts   DeepSeek / Kimi / Qwen + custom OpenAI-compatible
                           endpoints (fetch + SSE, zero deps)
```

## Data flow

1. Extension extracts a JD from the job page into structured JSON.
2. Extension POSTs to `POST /v1/chat` (or a Phase 1+ domain endpoint).
3. Core enqueues the request (queue, concurrency-limited) and broadcasts
   `job/queued` over `/ws`.
4. The configured `ChatProvider` streams chunks back; the queue broadcasts
   `job/started` / `job/done` / `job/error`.
5. Extension renders the result and fills it into the page.

## Design decisions

- **All LLM calls go through `ChatProvider`** — adding a new provider is one
  class + one factory case, not a core change. deepseek/kimi/qwen share the
  OpenAI-compatible client; provider-specific params are keyed off baseUrl
  (pattern ported from TomiLite's production integration):
  DeepSeek v4 `thinking: {type}` toggle, Qwen `enable_thinking` (only when
  true), Kimi standard params.
- **Concurrency-limited queue**: each `claude-code` call spawns a Claude Code
  CLI subprocess (~1-2 s cold start on Windows), so the default limit is 2.
- **Headless mode**: `claude-code` runs with `permissionMode:
  "bypassPermissions"` because the service has no interactive terminal.
- **Local-only binding**: the server binds `127.0.0.1` and never listens on
  external interfaces. The extension is the only intended client.
- **Resume loading is file-format agnostic**: `jd/resume-files.ts` reads
  `resume.md` / `resume.txt` directly and parses `resume.docx` (mammoth) and
  `resume.pdf` (pdfjs) on the machine — priority md > txt > docx > pdf. The
  extension mirrors this in-browser (`options/resume-parser.ts`) so direct
  mode never uploads a resume either.
