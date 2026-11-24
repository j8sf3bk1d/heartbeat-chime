# Validation

Start with the relevant unit or integration checks, then broaden when changes affect shared state, imports, security, dependencies, scheduling or desktop packaging.

- `npm test`: unit and integration tests.
- `npm run test:e2e`: browser tests (requires Playwright Chromium; `npm run test:e2e:install` installs it).
- `npm run build`: production frontend.
- `npm run tauri:build:app`: macOS app bundle with a suitable Tauri toolchain.
- `npm run package:macos`: staged local macOS bundle; not a signed/notarized public release.

Browser tests do not prove native audio, app coexistence, sleep/wake, login startup, signing or a particular target OS. For those, use an isolated installation and record the environment and outcome. Never modify or stop someone's running app without coordinating.
