# Make a Heartbeat character with an agent

This kit takes a character description through artwork, animation frames, mask tuning, validation, and an importable Heartbeat character JSON. It is intended for an agent with image-generation and visual-review capabilities; you do not need to draw or hand-label every image. The current format is a local prototype, not yet a stable public pack contract.

To create or import audio alongside your character, see [voice and sound generation](audio-generation.md). Visual packs and imported voice clips remain independent; custom dialogue and expression mapping are future work.

## Start in a fresh agent chat

Open this repository in the chat and paste:

> Follow `docs/character-creator/agent-workflow.md` to make me an importable Heartbeat character pack. My character: [describe appearance, personality, and style]. Ask me only for details that would change the result; use your judgment for the rest. Show me the concept and the finished pack, including what you could and could not validate.

The default finished visual pack includes all eight expression slots with registered base, blink, and talk frames and a visual review. A concept or a smaller playable prototype can be requested as an earlier stop; the agent should state what remains. A usable file, a visually reviewed pack, and a native playtest are separate evidence levels.

A useful description can include outfit, palette, pose, art style, personality, intended audience, and any visual references. For a local experiment, a short description is fine. If you intend to share a pack, supply artwork and voice rights appropriate to that use; an existing franchise or a particular performer's voice may not be yours to distribute.

## What you get today

A character pack contains portrait artwork and animation masks. It does **not** include voice clips, chime assignments, spoken scripts, or a voice provider. Importing it switches the character's appearance without switching the voice. Built-in clips have authored dialogue/expression metadata; ordinary imported sounds currently fall back to their label and a neutral expression. See [voice and character direction](voice-packs.md) for a proposed cohesive character-and-voice experience and current limitations.

Once the pack is ready, import its JSON using **Settings → Visual novel companion → Import character** and select it there. To revise an already imported character, select it and use **Update selected character** with the new JSON. The app validates the replacement before saving it, keeps the character selected, and refreshes the companion on the next preview or chime. Import remains the way to add a separate copy. The dialogue name can use the pack name or a custom preference in companion settings; the pack name itself remains unchanged. Existing sounds, chimes, and assignments are independent. Full Heartbeat backups include imported characters and the selected character. The visual-only browser lab is useful before import; it does not prove native audio synchronization.

The executable workflow, manifest format, and review checklist are in [agent workflow](agent-workflow.md). The [minimal example](../../examples/character/character-source.json) is a still placeholder that demonstrates the format, not a finished character. The packer reads only local PNG files under the source manifest's directory and never runs source content.
