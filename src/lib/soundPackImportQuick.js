import {
  INTERVAL_MINUTES,
  assert,
  isAudioFile,
  makeUniqueId,
  normalizeGeneratedId,
  normalizeId,
  normalizeLabel,
  normalizeOptionalText,
  prettifyLabel,
  splitFileNameParts,
  toCustomPresetId,
  toCustomProfileId
} from "./soundPackImportShared.js";

export async function buildSoundPackFromAudioFiles(fileListLike, options = {}) {
  const allFiles = Array.from(fileListLike || []);
  const audioFiles = allFiles.filter((file) => isAudioFile(file));
  assert(audioFiles.length > 0, "No audio files selected");

  const packLabel = normalizeLabel(options.packLabel, "Imported Clips");
  const nowSuffix = normalizeGeneratedId(options.packIdSuffix || Date.now().toString(36), "import");
  const packIdBase = normalizeGeneratedId(options.packId || packLabel, "clips");
  const packId = normalizeId(`${packIdBase}-${nowSuffix}`, "packId");
  const packDescription = normalizeOptionalText(options.description) || `Quick-imported ${audioFiles.length} clip(s).`;

  const usedSoundIds = new Set();
  const presets = audioFiles.map((file) => {
    const { baseName } = splitFileNameParts(file.name);
    const baseSoundId = normalizeGeneratedId(baseName, "clip");
    const soundId = makeUniqueId(baseSoundId, usedSoundIds);
    const label = prettifyLabel(baseName, `Clip ${usedSoundIds.size}`);
    return {
      id: toCustomPresetId(packId, soundId),
      packId,
      sourceSoundId: soundId,
      sourceFileName: file.name,
      label,
      description: "",
      tags: ["quick-import"],
      file
    };
  });

  const firstPresetId = presets[0].id;
  const intervalPresetByMinutes = INTERVAL_MINUTES.reduce((acc, minutes) => {
    acc[minutes] = firstPresetId;
    return acc;
  }, {});

  const profiles = [
    {
      id: toCustomProfileId(packId, "default"),
      packId,
      label: `${packLabel} Mode`,
      description: "Auto-generated from quick-imported clips.",
      intervalPresetByMinutes,
      relativeDefaultPresetId: firstPresetId,
      absoluteDefaultPresetId: firstPresetId
    }
  ];

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
