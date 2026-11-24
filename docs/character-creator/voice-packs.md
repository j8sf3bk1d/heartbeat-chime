# Character-specific voice packs: direction for a future slice

A coherent character needs more than a sprite swap: a battle-hungry hero, a shy assistant, and a snarky rival need distinct writing, performance, cadence, and expressions. The user should be able to choose a character and a matching voice set, while retaining the option to mix and match. This is a design direction, not implemented behavior.

## Present behavior

Character JSON contains images and masks only; switching it leaves audio and assignments alone. Built-in voice clips carry line text, expression and other metadata. The current companion cue looks up that metadata only for built-in voices; custom imported sounds display their label and resolve to neutral. Existing sound-pack import supports audio, labels, generic tags and profiles, but does not carry custom companion dialogue or expression mappings. A creator can prepare a written script or audio files separately today, but cannot deliver the full authored performance through the character importer.

## Proposed creation and playback model

- Start with a character brief: personality, tone boundaries, sample phrases, relationships to the user, and visual state vocabulary. Agent proposes a small sample for approval before creating a larger bank. Each line has a stable ID, actual spoken text, delivery direction, interval applicability, intended expression, and one or more alternate recorded takes. Reuse the existing line-level repeat guard so alternate takes do not masquerade as different lines.
- Generate or supply voice audio through an explicitly chosen provider or system TTS, and retain provider-specific directions as authoring metadata rather than baking credentials into a pack. Support previewing cost, provider capabilities and rights before generation; no provider account should be required to play a completed pack. Obtain appropriate rights/consent for recognizable voices and distribution; a character-inspired writing style need not imitate an actor.
- Store authored text, line ID, intervals and expression with the imported audio in a versioned, validated voice pack. Map expression to existing slots; a missing expression falls back to neutral. Text must be displayed as text, not HTML, and audio remains local. Validate media, size, metadata, uniqueness, bounds, missing assets and interval coverage. Clips without metadata retain the existing safe fallback.
- A higher-level optional bundle can point to a character and one or more voice packs, or supply a compatible combination. Preview changes, report missing components, and apply explicitly without overwriting existing audio, weights, intervals, chimes or user configurations. Keep character and voice independently switchable. Define stable IDs, collisions, migrations, exports and full-backup behavior before promising one-click swaps.
- Keep sound timing and native playback behavior unchanged during asset integration. Demonstrate a complete cue with the selected voice, matching text, expression, repeat handling, backup/restore and switching in a disposable profile before exposing it as finished.

## Open choices

Choose the distribution container and stable identity/version scheme; decide whether the visual slot taxonomy needs extensible semantic mappings; define how switching a voice set interacts with existing interval assignments and weights; decide whether both generated and system TTS voices need live synthesis or only pre-rendered assets. Test a small set of original, rights-cleared character lines before scaling production. A normal non-voice chime pack remains useful independently.
