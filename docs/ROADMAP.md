# Development roadmap

This is a free, as-is reference project. Source sharing and supported binary releases are separate.

- Verify desktop isolation, imported character switching, audio, backup/restore, startup and packaging on target platforms.
- Use the [release audit](release-audit.md) to guide best-effort maintenance: keep media provenance and third-party notices, and add a reporting channel and CI when practical. Historical metadata has been removed from reachable history.
- Keep the existing voice pack and synthesized chimes; consider an additional brighter voice pack with previews and clear tone choices.
- The four owner-auditioned sound-effect themes now have tagged built-in clips and reversible quick setup. Keep provider provenance with the assets; add reusable named user presets if needed.
- Develop character-specific voice-pack metadata and creation flows; character visuals, sound selection and assignments remain independently switchable. See character-creator/voice-packs.md.
- Expand character animation and lab coverage with purpose-made distributable full-expression fixtures; the included example is a still image only.
- Configure the remote once the owner supplies it. Do not publish automatically. Code uses MIT; media and third-party terms remain separate.
