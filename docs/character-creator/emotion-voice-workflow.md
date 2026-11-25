# From character concept to expressive voice cues

This is an authoring workflow for a person and an agent. It documents the process used to make Heartbeat's included voice bank, and where the current implementation stops. It is not a new import format.

## What already works

Heartbeat includes **150 ElevenLabs-generated Laura MP3s**, representing 75 written lines with two takes each. The files and their [manifest](../../src/assets/voices/laura/manifest.json) ship in the source; playback needs no ElevenLabs account. These are rendered recordings, not the underlying voice model or an API key. The manifest identifies Laura (`FGY2WhTYpPnrIDTdsKH5`), Eleven v4, original delivery direction, clean dialogue, intended expression, interval, line ID and take. The same 150 recordings and clip metadata are used in the original private project.

The included bank has 33 paired lines for one minute, 22 for five minutes, and 10 each for 15 and 60 minutes. Every interval has at least one paired line in each of the eight expression classes. The runtime looks up metadata for the **actual selected built-in take** and shows its text and expression. Related takes share a line ID, which the consecutive-repeat guard uses to avoid treating alternate takes as different lines.

A visual character pack can use this built-in bank: its own `smug`, `caring`, and other matching expressions appear when those existing cues play. Swapping the visual character does not change the lines or voice.

**Current limit:** The user-facing sound-pack importer does not retain custom line text, expression or shared line IDs. An imported sound shows its label with a neutral expression and is treated as its own repeat group. Its optional minute tags are useful for finding and selecting clips, but do not map expressions. A custom voice bank with authored expressions therefore needs a source-code integration today; a portable importable voice pack is [future work](voice-packs.md).

## 1. Develop the character and coverage

1. Write a brief describing the character's personality, relationship to the user, tone boundaries, sample dialogue and intended use. Agree on voice rights, provider, time intervals, target quantity, delivery style and spending limit before generating audio.
2. Pick from the current fixed visual slots: `neutral`, `smug`, `flustered`, `hmph`, `caring`, `impressed`, `exasperated`, and `delighted`. A delivery direction and a visual expression are separate choices: an impatient line might suit `hmph` or `exasperated` depending on the performance and artwork.
3. Make a coverage table with interval, visual expression, written line, delivery direction, stable line ID and number of takes. The shipped bank aimed for at least one paired line per expression at each of 1, 5, 15 and 60 minutes; it has extra variety at frequently heard intervals. Tailor this target to the user's preference instead of requiring it for every concept.
4. Review a few representative lines with the user, including potentially sharper or more affectionate tones, and refine before generating the full set. Character art must have compatible expression frames; missing frames may fall back to neutral.

## 2. Generate and evaluate

1. Choose a voice the user is allowed to use. Generate a small audition using short delivery directions where supported, then listen and adjust the writing, model, direction and loudness. With ElevenLabs v3/v4, square-bracket audio tags are performance cues; keep those separate from the clean caption. See [audio generation](audio-generation.md) for an API example and credential handling.
2. When the user authorizes the batch and cost, render each approved line and its alternate takes to separate files. Give every take a unique file and clip ID, but retain the same line ID, clean text, interval and intended expression for the pair. Save the source brief and generation notes outside the pack, without credentials. Avoid automatic retry of a request whose billing/result is unknown.
3. Listen to every output, verify distinct alternate takes, trim excessive leading silence and check for clipping. Normalize consistently if appropriate, without claiming that a loudness number alone proves the recording sounds good. Measure duration, size and SHA-256 after any conversion. Review actual speech against the intended text and expression.

## 3. Connect to the current app

For a no-code result, import the audio under **Sounds**, assign it under **Chimes** and accept the neutral-expression limitation above. Keep the authoring table for future migration; generic sound tags alone do not activate expression mapping.

For a developer-controlled build that needs expression mapping now, use the bundled implementation as a reference: [manifest](../../src/assets/voices/laura/manifest.json), [voice loader and validation](../../src/lib/builtInVoices.js), [cue mapping](../../src/lib/companion.js), and [repeat grouping](../../src/lib/cueSoundHelpers.js). Each existing manifest entry records `id`, `fileName`, `text`, `direction`, `directedText`, `intervalMinutes`, `expression`, `lineId`, `generation`, status, duration, byte count and hash. `directedText` contains provider instructions; `text` is the caption. A `lineId` links takes 1 and 2 of the same wording and expression.

The bundled loader is a **hard-coded, single-bank implementation**, not a generic pack loader. It expects paired completed files, unique IDs, specific interval and expression coverage and versioned migration conditions. Its frequency-coverage checks also depend on the existing collection composition. Simply dropping in a JSON manifest or appending clips can make the whole bundled voice set unavailable. An agent changing the bank must inspect and adapt those constraints, asset loading, selections and migration behavior; preserve existing configurations and avoid silently replacing the user's assigned sounds. A separate, validated imported voice-pack feature would be a better reusable design.

## 4. Validate and hand off

- Check the desired interval × expression table for missing lines and paired takes. Validate the actual files, unique IDs, hashes, durations and clean captions; run the applicable [bundled voice tests](../../tests/unit/voice-pack.test.js), [loader tests](../../tests/unit/built-in-voices.test.js) and companion tests after adapting fixtures to any intentional new design.
- In a disposable profile, choose actual takes and confirm that the displayed caption and expression match the chosen file, including both alternatives, repeat behavior, startup and any export/restore path. Confirm imported audio still behaves as documented.
- Playtest the real desktop companion with audio where available; check timing, silent-mouth frames, visual registration and fallback expressions. A manifest check cannot prove audio quality or facial animation.
- Report the source brief, generated audio, manifest or integration changes, coverage, provider/model and rights considerations, cost evidence, test results, and any remaining limitations. Distinguish authored files, format checks, browser tests and native playtesting. Do not present a neutral imported sound collection as an expression-mapped voice pack.
