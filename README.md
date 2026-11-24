# Heartbeat Chime — community development preview

Heartbeat is a local desktop chime app with customizable schedules, imported sounds, a visual-novel-style companion, character packs and portable backup. This sibling is an early public-source candidate, not yet a public release. It has no configured Git remote.

It includes synthesized chimes and the existing spoken pack. Heartbeat’s original character is included; you can also import your own character pack in Settings. The [agent-assisted creator kit](docs/character-creator/README.md) explains how to create one. Character packs currently change appearance, not the voice or dialogue.

## Start with an agent

Open this repository in your preferred agentic tool and say: “Existing repo: read the cold-start guidance, then help me start working on Heartbeat.” The provider-neutral [cold-start guide](docs/process/cold-start.md) explains what to read, how to preserve existing work, and how to coordinate changes.

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

For contributor scope and work remaining, see [roadmap](docs/ROADMAP.md) and [sync policy](docs/upstream-sync.md). Before publishing, verify asset rights, privacy, security, and desktop behavior. Do not assume this candidate is ready for public redistribution.

## Theme quick setup

In **Chimes**, choose Machine shop, Public library, Japanese train station, or Restaurant and select **Apply quick setup**. Each theme enables the 1-, 5-, 15-, and 60-minute intervals and disables the 10- and 30-minute intervals; the description shows the impact before you apply. Sounds and weights for recurring intervals are replaced, while volumes, timers, imported audio and tags are retained. Nothing starts playing until you start chimes.

**Undo last setup** restores the previous interval configuration during the current session. If you edit an interval assignment or its enabled state afterward, undo refuses to overwrite that edit. For a reusable or portable copy, use **Settings → Full backup** before changing your setup; named custom presets are not yet supported. Individual themed sounds can be previewed or mixed with other sounds, and their suggested interval tags can be changed in Sounds.

## License

Original code and documentation are under the [MIT License](LICENSE). Media and third-party dependencies have separate terms; see [license scope](LICENSE-CONTENT.md).
