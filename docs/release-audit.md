# Public readiness audit — 2026-11-23

Scope: local community sibling, source and reachable Git history; no remote or public release. This is a release-readiness review, not a penetration test or legal opinion. Owner selected MIT for original code and docs. See [license scope](../LICENSE-CONTENT.md); media and third-party dependencies are excluded.

## Findings before a public push

1. **Generated-media distribution terms need confirmation.** The owner has authorized including the original character and ElevenLabs-generated audio in this candidate. The voice manifest identifies Laura as a default voice; [ElevenLabs' catalog](https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices) confirms that voice ID. ElevenLabs says [paid-plan output can have commercial use rights, subject to conditions](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform); its [use policy](https://elevenlabs.io/use-policy) also restricts making output available on more permissive terms. Confirm the plan and applicable model/voice terms when generated, and whether publishing the standalone files in a forkable GitHub repository is permitted. Choose explicit media permissions after that review; do not assume the MIT code license applies to audio or art.
2. **Historical metadata requires a privacy decision.** The current voice manifest no longer includes unrelated local project references or session authorization/budget notes. Earlier commits do contain those references; GitHub publication would expose them in history. Before a push, use a reviewed clean-history branch or explicitly accept their disclosure. No remote exists today. A pattern scan across reachable history found no PEM private keys, common GitHub tokens, OpenAI-style tokens, or AWS access-key patterns; this is not an exhaustive secret scan.
3. **Third-party license distribution review remains.** All 536 Cargo package metadata entries declare a license or license file after marking the local app package MIT. All 49 installed npm package manifests declared licenses. Declarations do not replace a target-specific review of bundled components, notices, and system-library obligations. The vendored glib crate retains its own MIT license and copyright; Linux system libraries can have additional obligations.
4. **Set a private vulnerability-reporting path** once the GitHub repository exists; see [SECURITY](../SECURITY.md). Decide supported targets and establish CI, dependency scanning and release ownership.

## Dependencies

`npm audit` returned zero advisories on the checked lockfile. OSV Scanner 2.4.0 checked npm and Cargo lockfiles. The Rust lockfile initially included [cookie RUSTSEC-2026-0594](https://rustsec.org/advisories/RUSTSEC-2026-0594.html) and [url RUSTSEC-2026-0592](https://rustsec.org/advisories/RUSTSEC-2026-0592.html); cookie was updated from 0.18.1 to 0.18.3, url from 2.5.8 to 2.5.9, and its form_urlencoded dependency from 1.2.2 to 1.2.3. The same updates were applied to the private sibling separately.

Remaining OSV lockfile results, without blanket suppression:

- `glib` 0.18.5 / RUSTSEC-2024-0429: Linux GTK dependency. The vendored source contains a documented backport of this particular fix; the unchanged version is still flagged. It does not remedy other GTK-stack risks or prove target-platform safety. See [patch record](../vendor/glib-0.18.5/HEARTBEAT-PATCH.md).
- `rand` 0.7.3 / RUSTSEC-2026-0097: old `phf_generator` build dependency. The advisory requires a custom logger that re-enters the thread RNG and the relevant logging feature; current host feature output did not show that feature. The dependency remains unpatched and needs reevaluation as the upstream chain changes.
- `rkyv` 0.7.46 / RUSTSEC-2026-0235 and `chrono` 0.4.43 / RUSTSEC-2026-0543: present in the Cargo lockfile, but `cargo tree --locked --target all -i` printed no active dependency path for either in this resolution. Recheck if features or targets change; rkyv 0.7 has no fixed release for its reported issue.
- `fxhash`, `pin-utils`, and `proc-macro-error`: OSV marks these versions unmaintained in transitive upstream chains; monitor and remove when upstream permits. No unsupported claim of exploitability or complete remediation is made.

The current build enforces a restrictive Tauri CSP, scopes companion/diagnostic permissions, and stores imported media locally. Those observations are not a substitute for a fresh full application security review or fuzzing.

## Binary release versus public source

A successful local build is not a distributable release. Native desktop isolation, bundled audio playback, character/import and backup flows, startup, sleep/wake and target-platform smoke tests remain to be performed. For macOS outside the App Store, review [Tauri's signing and notarization guidance](https://v2.tauri.app/distribute/sign/macos/); the local staged app is not an independently signed, notarized release. Linux and Windows have not been validated as release targets. A public source repository can precede signed binaries, but it must not be mistaken for a validated binary release.
