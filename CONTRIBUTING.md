# Contributing to Tomi-Job-Hunt

Thanks for your interest in contributing! 🎉

## Ground rules

- **Privacy first.** This project's core value is that all user data stays on
  the user's machine. Never add telemetry, external analytics, or code that
  sends job/resume data anywhere other than the user's chosen LLM API.
- All code, comments, and commit messages are written in **English**.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for
  commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Development setup

```bash
# Prerequisites: Node.js >= 20
git clone https://github.com/<your-fork>/tomi-job-hunt.git
cd tomi-job-hunt
npm install
npm run dev -w core        # starts the local Core service on 127.0.0.1:3000
npm test -w core           # runs unit tests
```

## Project structure

```
core/        Core local service (TypeScript, Hono, LLM providers)
extension/   Chrome/Edge MV3 browser extension
docs/        Architecture & privacy documentation
```

## Workflow

1. Open an issue (or comment on an existing one) describing what you want to do.
2. Create a branch: `git checkout -b feat/my-feature`.
3. Write code + tests. Keep dependencies minimal — justify any new runtime dep.
4. Run `npm test -w core` and a local smoke test before pushing.
5. Open a PR using the pull request template.

## Code style

- TypeScript strict mode. Prefer explicit types in public interfaces
  (`core/src/types.ts`).
- Log messages go through the shared logger, never `console.log`.
- LLM providers implement the `ChatProvider` interface in
  `core/src/llm/chat-provider.ts`. New providers (e.g. Qwen) must support both
  `chat()` and `chatStream()`.

## Questions?

Open a discussion or issue — we're happy to help.
