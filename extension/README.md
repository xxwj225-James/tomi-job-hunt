# Browser Extension (Phase 1 — MVP closed loop)

Chrome/Edge MV3 extension: extracts JDs from Boss直聘 / 猎聘 job detail
pages, sends them to the local Core service for structured tagging and
greeting-pitch generation, and fills the pitch into the Boss直聘 chat box.

## How it works

```
job detail page (zhipin/liepin)
  ├─ extract JD: zhipin = /wapi/zpgeek/job/detail.json (plaintext salary,
  │   beats the dynamic salary font) with DOM fallback; liepin = DOM after
  │   AJAX-injected content appears (waitForJd)
  ├─ POST /v1/jd/capture → Core stores + async LLM tagging (WS jd/tagged)
  └─ POST /v1/greeting → 100-120 字打招呼语（结合本地简历文件）

立即沟通 navigates to /web/geek/chat/* (SPA) — the pitch travels there via
chrome.storage.session, and zhipin-chat.ts fills the chat box, which is a
contenteditable div (NOT a textarea) in the current site build.
```

## Build & load (Chrome / Edge)

```bash
npm install          # at repo root
npm run build -w extension
```

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. **Load unpacked** → select `extension/dist/`
4. Start the Core service: `npm run dev -w core`

## Resume upload (direct mode)

The options page (🤖 → ⚙️ 设置) accepts a resume file — PDF, Word (.docx),
.txt or .md. It is parsed **locally in the browser** (pdfjs / mammoth) and
kept in `chrome.storage.local`; nothing is uploaded. Greeting / match /
interview-prep prompts then use it. Legacy .doc is not parseable in-browser —
export to .docx or PDF first. Core mode instead reads
`~/.tomi-job-hunt/resume.md` / `resume.docx` / `resume.pdf` server-side.

## Develop

```bash
npm run dev -w extension   # vite build --watch (rebuild then reload in chrome://extensions)
npm test -w extension      # extractor/fill unit tests (jsdom fixtures)
```

## Site compatibility notes (verified via live research, 2026-08)

- **zhipin anti-obfuscation**: salary digits are rendered with a per-session
  custom font (DOM text is garbage) — the JSON API path is primary; JD text
  contains CSS-hidden interference words, stripped by `stripHidden()` in
  `src/content/shared.ts`.
- **zhipin chat box**: `contenteditable` div (`#chat-input.chat-input`);
  filled via textContent + caret + beforeinput/input events. The textarea
  path (native value setter) is kept as fallback.
- **liepin**: SSR shell first, detail body injected client-side —
  `waitForJd()` polls until selectors resolve. Current detail-page class
  names should be re-verified in DevTools if extraction comes up empty
  (candidate selectors cover current + legacy layouts).
- Content scripts auto-run only in the real browser (guarded by
  `typeof chrome !== 'undefined'`) so unit tests can import extractors.
