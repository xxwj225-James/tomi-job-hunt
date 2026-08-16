# Contributing to TomiHunt

Thanks for your interest in contributing! 🎉

## Ground rules

- **Privacy first.** This project's core value is that all user data stays on
  the user's machine. Never add telemetry, external analytics, or code that
  sends job/resume data anywhere other than the user's chosen LLM API.
- **Compliance moat.** Anything shareable must pass through
  `core/src/jd/sanitize.ts` (`buildSharedIntel`) — raw JD text, HR names and
  contact details never leave the machine.
- All code, comments, and commit messages are written in **English**.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for
  commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Development setup

```bash
# Prerequisites: Node.js >= 20
git clone https://github.com/<your-fork>/tomi-job-hunt.git
cd tomi-job-hunt
npm install
npm test                  # all workspace tests (core + extension)
npm run dev -w core       # local Core service on 127.0.0.1:3000 (watch mode)
npm run dev -w extension  # extension vite build --watch (then reload in chrome://extensions)
```

Run tests selectively: `npm test -w core` / `npm test -w extension`.

## Project structure

```
core/        Core local service (TypeScript, Hono, LLM providers, JD store/tagging/sanitize)
extension/   Chrome/Edge MV3 browser extension (Vite; content scripts, popup, jsdom tests)
docs/        Usage guide, architecture, privacy & compliance documentation
```

## Workflow

1. Open an issue (or comment on an existing one) describing what you want to do.
2. Create a branch: `git checkout -b feat/my-feature`.
3. Write code + tests. Keep dependencies minimal — justify any new runtime dep.
4. Run `npm test` and a local smoke test before pushing.
5. Open a PR using the pull request template.

## Code style

- TypeScript strict mode. Prefer explicit types in public interfaces
  (`core/src/types.ts`).
- Log messages go through the shared logger, never `console.log`.
- LLM providers implement the `ChatProvider` interface in
  `core/src/llm/chat-provider.ts`. New providers (e.g. local Ollama) must
  support both `chat()` and `chatStream()`.
- Extension extractors take a `Document` parameter (never touch the global
  `document` directly) so they stay testable with jsdom fixtures, and
  auto-run only when `typeof chrome !== 'undefined'`.

## Questions?

Open a discussion or issue — we're happy to help.
