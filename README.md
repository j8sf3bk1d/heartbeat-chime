# Heartbeat Chime

![Heartbeat Chime: chimes, voice cues, and a companion with opinions](docs/assets/social-preview.jpg)

**A little nudge, right on time.**

Heartbeat is a local-first chime app for your desktop, with customizable sounds, voice cues, and an optional visual-novel companion. Let it sit in the background and mark the passage of time—or bring a character along to deliver your reminders with a little more personality.

- **Make it yours:** choose clock-aligned intervals, volume, voice clips, and sound-effect themes, or import your own sounds.
- **Bring a companion:** show the included character in a screen corner, or import and switch your own character packs. See the [agent-assisted creator kit](docs/character-creator/README.md).
- **Keep your setup:** export a full backup with settings, imported audio, and character packs.

Character packs currently change appearance, not the voice or dialogue. Heartbeat is a free, as-is reference project; native release and platform checks are still in progress.

## Start with an agent

Open this repository in your preferred agentic tool and say: “Existing repo: read the cold-start guidance, then help me start working on Heartbeat.” The provider-neutral [cold-start guide](docs/process/cold-start.md) explains what to read, how to preserve existing work, and how to coordinate changes.

## Run from source

Install Node.js 22 or 24, Rust 1.90 or newer, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform. From the repository root, install dependencies and run the checks:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Choose one development mode:

- **Desktop app:** run `npm run tauri:dev`. This starts its own frontend server on port 5179 and opens the Tauri app.
- **Browser preview:** run `npm run dev`, then open the local URL it prints. Stop that server before starting `npm run tauri:dev`; both use port 5179.

The browser preview is useful for exploring settings and chimes. Native features such as the always-on-top companion overlay, tray, launch at login and macOS native audio need the desktop app. The first build may take several minutes.

The desktop bundle ID is `org.heartbeat.community.preview` and its product name is `Heartbeat Chime Community`; native data isolation from other installations has not yet been verified on a target machine. Avoid importing your primary data until that check is complete. `npm run package:macos` builds into a temporary directory and stages a durable app under ignored `artifacts/`; preserve any app you use before cleaning artifacts.

For contributor scope and work remaining, see [roadmap](docs/ROADMAP.md) and [sync policy](docs/upstream-sync.md). Security, compatibility and packaging are best effort; see the [audit](docs/release-audit.md) for known limitations. Source sharing and a supported, signed binary release are separate steps.

## Theme quick setup

In **Chimes**, choose Machine shop, Public library, Japanese train station, or Restaurant and select **Apply quick setup**. Each theme enables the 1-, 5-, 15-, and 60-minute intervals and disables the 10- and 30-minute intervals; the description shows the impact before you apply. Sounds and weights for recurring intervals are replaced, while volumes, timers, imported audio and tags are retained. Nothing starts playing until you start chimes.

**Undo last setup** restores the previous interval configuration during the current session. If you edit an interval assignment or its enabled state afterward, undo refuses to overwrite that edit. For a reusable or portable copy, use **Settings → Full backup** before changing your setup; named custom presets are not yet supported. Individual themed sounds can be previewed or mixed with other sounds, and their suggested interval tags can be changed in Sounds.

In **Sounds → Browse Sounds**, search by name or filter by source, interval, and sound tag. Filtering only changes the displayed list; it does not change assignments or saved tags.

## License

Original code and documentation are under the [MIT License](LICENSE). Media and third-party dependencies have separate terms; see [license scope](LICENSE-CONTENT.md).
