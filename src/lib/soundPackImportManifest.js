import {
  INTERVAL_MINUTES,
  assert,
  ensureSoundIdsExist,
  fileByName,
  normalizeId,
  normalizeOptionalText,
  toCustomPresetId,
  toCustomProfileId
} from "./soundPackImportShared.js";

export async function buildSoundPackFromFiles(fileListLike) {
  const files = Array.from(fileListLike || []);
  assert(files.length > 0, "No files selected");

  const manifestFile =
    files.find((file) => file.name.toLowerCase() === "pack.json") ||
    files.find((file) => file.name.toLowerCase().endsWith(".json"));
  assert(manifestFile, "Pack manifest file (pack.json) is required");

  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.text());
  } catch (error) {
    throw new Error("Pack manifest is not valid JSON");
  }

  const packId = normalizeId(manifest.packId, "packId");
  const packLabel = normalizeOptionalText(manifest.label) || packId;
  const packDescription = normalizeOptionalText(manifest.description);

  assert(Array.isArray(manifest.sounds) && manifest.sounds.length > 0, "sounds[] is required");

  const filesByName = fileByName(files);
  const soundIds = new Set();
  const presets = manifest.sounds.map((sound) => {
    const soundId = normalizeId(sound.id, "sound.id");
    assert(!soundIds.has(soundId), `Duplicate sound id "${soundId}"`);
    soundIds.add(soundId);

    const sourceFileName = typeof sound.file === "string" ? sound.file.trim() : "";
    assert(sourceFileName.length > 0, `sound.file is required for "${soundId}"`);
    const file = filesByName.get(sourceFileName);
    assert(file, `Missing sound file "${sourceFileName}" for sound "${soundId}"`);

    return {
      id: toCustomPresetId(packId, soundId),
      packId,
      sourceSoundId: soundId,
      sourceFileName,
      label: normalizeOptionalText(sound.label) || soundId,
      description: normalizeOptionalText(sound.description),
      tags: Array.isArray(sound.tags) ? sound.tags.filter((tag) => typeof tag === "string") : [],
      file
    };
  });

  const profileInputs =
    Array.isArray(manifest.profiles) && manifest.profiles.length > 0
      ? manifest.profiles
      : [
          {
            id: "default",
            label: `${packLabel} Default`,
            description: packDescription,
            intervalPresetByMinutes: {}
          }
        ];

  const profiles = profileInputs.map((profile) => {
    const profileSourceId = normalizeId(profile.id, "profile.id");
    const profileId = toCustomProfileId(packId, profileSourceId);
    const map = {};
    for (const minutes of INTERVAL_MINUTES) {
      const configuredSoundId = profile.intervalPresetByMinutes?.[minutes];
      const fallbackSoundId = presets[0].sourceSoundId;
      const sourceSoundId = configuredSoundId || fallbackSoundId;
      ensureSoundIdsExist(soundIds, sourceSoundId, `profile.intervalPresetByMinutes[${minutes}]`);
      map[minutes] = toCustomPresetId(packId, sourceSoundId);
    }

    const relativeDefaultSoundId = profile.relativeDefaultSoundId || presets[0].sourceSoundId;
    const absoluteDefaultSoundId = profile.absoluteDefaultSoundId || presets[0].sourceSoundId;
    ensureSoundIdsExist(soundIds, relativeDefaultSoundId, "profile.relativeDefaultSoundId");
    ensureSoundIdsExist(soundIds, absoluteDefaultSoundId, "profile.absoluteDefaultSoundId");

    return {
      id: profileId,
      packId,
      label: normalizeOptionalText(profile.label) || profileSourceId,
      description: normalizeOptionalText(profile.description),
      intervalPresetByMinutes: map,
      relativeDefaultPresetId: toCustomPresetId(packId, relativeDefaultSoundId),
      absoluteDefaultPresetId: toCustomPresetId(packId, absoluteDefaultSoundId)
    };
  });

  return {
    pack: {
      id: packId,
      label: packLabel,
      description: packDescription
    },
    presets,
    profiles
  };
}
