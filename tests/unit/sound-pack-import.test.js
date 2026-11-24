import { describe, expect, it } from "vitest";
import { buildSoundPackFromAudioFiles, buildSoundPackFromFiles } from "../../src/lib/soundPackImport.js";

function createManifestFile(manifest) {
  return {
    name: "pack.json",
    async text() {
      return JSON.stringify(manifest);
    }
  };
}

describe("sound pack import parser", () => {
  it("parses manifest + files into custom presets and profiles", async () => {
    const manifest = {
      packId: "anime_pack",
      label: "Anime Pack",
      sounds: [
        { id: "tick", label: "Tick", file: "tick.wav" },
        { id: "bell", label: "Bell", file: "bell.wav" }
      ],
      profiles: [
        {
          id: "focus_mode",
          label: "Focus Mode",
          intervalPresetByMinutes: { 1: "tick", 5: "tick", 10: "bell", 15: "bell", 30: "bell", 60: "bell" },
          relativeDefaultSoundId: "tick",
          absoluteDefaultSoundId: "bell"
        }
      ]
    };
    const bundle = await buildSoundPackFromFiles([
      createManifestFile(manifest),
      { name: "tick.wav", type: "audio/wav" },
      { name: "bell.wav", type: "audio/wav" }
    ]);

    expect(bundle.pack.id).toBe("anime_pack");
    expect(bundle.presets).toHaveLength(2);
    expect(bundle.profiles).toHaveLength(1);
    expect(bundle.profiles[0].id).toBe("custom:anime_pack:focus_mode");
    expect(bundle.profiles[0].intervalPresetByMinutes[1]).toBe("custom:anime_pack:tick");
  });

  it("throws when manifest references missing files", async () => {
    const manifest = {
      packId: "broken_pack",
      sounds: [{ id: "tick", file: "missing.wav" }]
    };
    await expect(buildSoundPackFromFiles([createManifestFile(manifest)])).rejects.toThrow(
      /Missing sound file/
    );
  });

  it("builds a default profile when manifest omits profiles", async () => {
    const manifest = {
      packId: "simple_pack",
      label: "Simple Pack",
      sounds: [{ id: "tick", label: "Tick", file: "tick.wav" }]
    };
    const bundle = await buildSoundPackFromFiles([createManifestFile(manifest), { name: "tick.wav", type: "audio/wav" }]);

    expect(bundle.profiles).toHaveLength(1);
    expect(bundle.profiles[0].id).toBe("custom:simple_pack:default");
    expect(bundle.profiles[0].intervalPresetByMinutes[1]).toBe("custom:simple_pack:tick");
    expect(bundle.profiles[0].relativeDefaultPresetId).toBe("custom:simple_pack:tick");
  });

  it("builds a quick clip bundle from loose audio files", async () => {
    const bundle = await buildSoundPackFromAudioFiles(
      [
        { name: "line-a.wav", type: "audio/wav" },
        { name: "line-b.wav", type: "audio/wav" },
        { name: "line-c.wav", type: "audio/wav" }
      ],
      {
        packLabel: "Anime Voice Lines",
        packIdSuffix: "test"
      }
    );

    expect(bundle.pack.id).toBe("anime-voice-lines-test");
    expect(bundle.pack.label).toBe("Anime Voice Lines");
    expect(bundle.presets).toHaveLength(3);
    expect(bundle.profiles).toHaveLength(1);
    expect(bundle.profiles[0].id).toBe("custom:anime-voice-lines-test:default");
    expect(bundle.profiles[0].intervalPresetByMinutes[1]).toBe(bundle.presets[0].id);
    expect(bundle.profiles[0].relativeDefaultPresetId).toBe(bundle.presets[0].id);
  });

  it("rejects quick import when no audio files are present", async () => {
    await expect(
      buildSoundPackFromAudioFiles(
        [
          { name: "notes.txt", type: "text/plain" },
          createManifestFile({ invalid: true })
        ],
        { packLabel: "Not Audio" }
      )
    ).rejects.toThrow(/No audio files selected/);
  });
});
