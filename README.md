# Heartbeat Chime — community development preview

Heartbeat is a local desktop chime app with customizable schedules, imported sounds, a visual-novel-style companion, character packs and portable backup. This sibling is an early public-source candidate, not yet a public release. It has no configured Git remote.

It includes synthesized chimes and the existing spoken pack. Heartbeat’s original character is included; you can also import your own character pack in Settings. The [agent-assisted creator kit](docs/character-creator/README.md) explains how to create one. Character packs currently change appearance, not the voice or dialogue.

## Develop

Install Node.js, Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```sh
npm ci --ignore-scripts
npm run dev
npm test
npm run build
npm run tauri:dev
```

The dev server uses port 5179 to keep its browser storage separate from the original app. The desktop bundle ID is `org.heartbeat.community.preview` and its product name is `Heartbeat Chime Community`; native data isolation has not yet been verified on a target machine. Avoid importing your primary data until that check is complete. `npm run package:macos` builds into a temporary directory and stages a durable app under ignored `artifacts/`; preserve any app you use before cleaning artifacts.

For contributor scope and work remaining, see [roadmap](docs/ROADMAP.md) and [sync policy](docs/upstream-sync.md). Before publishing, select a code license and verify asset rights, privacy, security, and desktop behavior. Do not assume this candidate is ready for public redistribution.
