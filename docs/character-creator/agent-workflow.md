# Agent workflow: character description to importable pack

## Outcome and boundaries

Produce a named Heartbeat character JSON and a concise handoff with paths, visual decisions, validation, known gaps, and import steps. Use the user's description and references, preserve their files and running app, and use a task-owned output folder. Image creation requires an available image-generation tool and its applicable workflow. In a Codex project, use the image-generation capability or skill when it is available and applicable. Other agents should check their own tools; no particular provider is required or assumed. If none is available, explain the capability gap and prepare the manifest/checklist; do not claim placeholder art is finished. Do not require provider API keys or copy secrets. Ask before spending on a separate paid service.

## Milestones and completion

Treat these as distinct deliverables, not interchangeable definitions of “done”:

- **Concept:** a character direction and representative art for feedback. It is not an importable or animation-reviewed pack unless separately demonstrated.
- **Playable prototype:** an importable, validated pack with at least a neutral base; report the actual expression and animation coverage, visual checks, fallback behavior and known defects. This is an early stop only when the user requests or accepts it, not the default response to a request for a character pack.
- **Full visual pack:** eight expression slots, each with its own registered base, blink and talk frames; silent bases have closed mouths; shared masks are tuned; the final JSON passes structural and image-decode checks; and every expression passes the visual and transition review below, or any remaining defect is explicitly identified. An accepted exception is not a passed check. Preserve the source manifest and art so revisions are reproducible.

Default to the full visual pack for an ordinary character-pack request. A concept is a useful checkpoint on the way to completion; seek feedback when it materially helps, then continue unless the user chose an earlier stop. If generation, visual inspection or another necessary capability is unavailable, name the blocker and the partial milestone rather than silently treating it as finished.

Record proof separately: **format-valid** means the packer and image decoder passed; **visually reviewed** means the stated lab checks were actually performed; **native-playtested** means the imported pack was exercised in the desktop companion, specifying whether real voice playback was checked. A full visual pack can be ready for a user's native playtest without claiming that playtest already happened. A user-visible quality problem still requires repair or an explicit unresolved-defect handoff.

## 1. Design and generate

1. Establish the character's identity, style, target pose and background transparency. Unless the user asks otherwise, create a compact expressive bust with enough face area for eyes and mouth. Show a concept for feedback when helpful; preserve defining features across variants. Generate with transparent backgrounds where possible.
2. By default, produce a full pack: base poses for `neutral`, `smug`, `flustered`, `hmph`, `caring`, `impressed`, `exasperated`, and `delighted`, each with blink and talk frames. The base is the **silent, closed-mouth state**, including for delighted, surprised, flustered and exasperated expressions; express emotion with the eyes, eyebrows, cheeks or a closed-mouth smile. This matters because the app removes the talk layer during silence and shows the base mouth. These are fixed app expression slots, not claims about the character's vocabulary. A concept or limited playable prototype is a valid earlier milestone only when requested or explicitly accepted; describe missing coverage instead of presenting it as a finished full pack. The format itself permits omitted expressions, which fall back to neutral.
3. For each expression, create matching `blink` (closed eyes) and `talk` (open mouth) PNGs. These are **full-canvas registered portraits**, not cropped patches. The app composites them through shared eye/mouth masks. Keep canvas size, head position, pose, silhouette and lighting registered across each expression's three frames; only the appropriate facial region should change. Missing layers become still faces. Inspect the images at actual overlay size and on light and dark backgrounds.
4. Keep originals and use a consistent file layout. All frames must be local PNG files underneath the manifest directory, with identical dimensions, at most 4096×4096. Build size must be under 64 MiB as JSON; each base64 image must be under 12 MiB. Downsize/compress if needed without blurring the face. The checker decodes images, but cannot decide whether art looks good or animations are registered.

The expressions are visual states. Existing dialogue is authored for Heartbeat's original character and does not change with the sprite. For character-specific lines, delivery and voices, read [voice-packs.md](voice-packs.md): this is a planned capability, not part of this pack format.

## 2. Describe and build

Put a `character-source.json` alongside the PNGs. Paths are relative to that file, including nested folders. Example:

```json
{
  "format": "heartbeat-character-source",
  "version": 1,
  "name": "Example character",
  "masks": {"eye-x": 50, "eye-y": 33, "eye-w": 23, "eye-h": 9, "mouth-x": 50, "mouth-y": 42, "mouth-w": 8, "mouth-h": 4},
  "frames": {
    "neutral": {"base": "neutral.png", "blink": "neutral-blink.png", "talk": "neutral-talk.png"},
    "smug": {"base": "smug.png", "blink": "smug-blink.png", "talk": "smug-talk.png"}
  }
}
```

For format compatibility, each included expression needs a `base`; `neutral.base` is the minimum required and blink/talk are optional. The default full-pack milestone above requires all eight sets. Unknown expressions and modes are rejected so spelling errors cannot silently drop work. Masks are percentages of the whole image: x/y are ellipse centers (0–100), w/h are base ellipse radii (1–50). The runtime adds two percentage points to the mouth horizontal radius and one to the vertical radius to cover the resting mouth; the lab displays the same final composite. The sample values are starting guesses, not universal facial coordinates.

From the repo root, with dependencies installed (`npm ci` when needed), run:

```sh
mkdir -p artifacts/character-packs
npm run character:pack -- build path/to/character-source.json artifacts/character-packs/my-character.json
npm run character:pack -- validate artifacts/character-packs/my-character.json
```

The output must not already exist; choose a new filename instead of overwriting. `build` and `validate` use the actual app structural validator and headless Chromium to decode every PNG. Install its browser with `npm run test:e2e:install` if unavailable. Paths escaping the source folder, including symlinks, are rejected. Validation enforces input limits, headers, dimensions and decoding; a transparent-corner warning is only a hint, not proof of good transparency. No PNGs or pack scripts are executed.


## 3. Tune and review

Run `npm run dev` and open the Vite URL ending in `/tools/character-preview/` in a task-owned browser tab. Import the JSON with **Import prototype pack**. For **every expression**, compare the silent base, blink alone, mouth small, medium and wide, and blink combined with each mouth state. Toggle repeatedly between closed and each opening and watch automatic playback; inspect enlarged facial crops and normal overlay size, then replay entrance/exit and inspect small and large preview sizes. Check for a mouth that stays open during silence, double lips or eyes, clipping, color seams, expression popping, unexpected facial movement, and mask bleed. The app currently uses the same full-size speaking patch for all non-silent mouth levels to cover the resting mouth. Check transitions against the closed state; if a future renderer adds intermediate shapes, review those separately. A static contact sheet cannot prove motion timing or eliminate transient artifacts. Change the eye/mouth controls until there are no clipped lids, duplicate features or visible seams. Inspect facial alignment in a visual tool, not just via the numeric checker. Preview mouth motion is synthetic; it is not an audio or native overlay test.

Export the tuned pack from the lab and validate that exported file with the command above. Copy the final mask values back into the source manifest if keeping it for reproducibility, then build a fresh output and validate it. Reinspect the changed expressions and rerun the complete affected transition matrix after every image or mask change; repeat until the visual defects are repaired or explicitly reported as unresolved. Compare with the actual native companion and a real voice preview when an isolated desktop test is available; otherwise report that limitation. The app uses one shared eye mask and one shared mouth mask for the whole character; if an expression needs different positions, regenerate or align its frames rather than claiming the mask supports per-expression coordinates.

## 4. Handoff

Report the final JSON path, source manifest/art paths, character description, expressions and layer coverage, visual review performed per expression and mouth state, validation command/results, known defects or unresolved registration, and the Settings import instructions. Distinguish format-valid, visually reviewed, and native-playtested evidence. A decoded image is not evidence that the character blinks or speaks correctly. State explicitly if image generation or visual review was unavailable. Do not claim native overlay, real voice sync, or public distribution rights without evidence. Keep the user's running app and data untouched; import into the user's app only when requested, or test in an isolated profile.
