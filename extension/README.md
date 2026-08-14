# Browser Extension (Phase 1)

The Chrome/Edge extension will be built here in **Phase 1** (Manifest V3).

## Planned scope

- **Single-page JD extraction** on Boss直聘 (`zhipin.com`) and 猎聘
  (`liepin.com`) job detail pages: title, salary, company, requirements, HR name
- **"Import to AI" button** sending structured JSON to the local Core service
  (`http://127.0.0.1:3000`)
- **One-click fill** of generated greeting messages into the Boss直聘 chat box
- Phase 3+: list-page filtering/highlighting, quick match-score badges

## Planned structure

```
extension/
├── manifest.json          MV3 manifest (permissions: activeTab, storage)
├── src/
│   ├── content/           per-site DOM extraction adapters (zhipin, liepin)
│   ├── popup/             extension popup UI
│   └── core-client.ts     HTTP/WS client for the Core service
```

Nothing in this directory is functional yet.
