export const INTERVAL_MINUTES = [1, 5, 10, 15, 30, 60];
const AUDIO_EXTENSIONS = new Set(["wav", "mp3", "ogg", "m4a", "aac", "flac", "webm", "opus", "aif", "aiff"]);

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function normalizeId(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} is required`);
  const normalized = value.trim();
  assert(/^[a-z0-9][a-z0-9_-]*$/i.test(normalized), `${label} must be alphanumeric plus _ or -`);
  return normalized.toLowerCase();
}

export function normalizeOptionalText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeLabel(value, fallback = "") {
  const normalized = normalizeOptionalText(value);
  return normalized || fallback;
}

export function fileByName(files) {
  const map = new Map();
  for (const file of files) {
    map.set(file.name, file);
  }
  return map;
}

export function splitFileNameParts(fileName = "") {
  const trimmed = typeof fileName === "string" ? fileName.trim() : "";
  if (!trimmed) {
    return { baseName: "", extension: "" };
  }
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return { baseName: trimmed, extension: "" };
  }
  return {
    baseName: trimmed.slice(0, lastDot),
    extension: trimmed.slice(lastDot + 1).toLowerCase()
  };
}

export function normalizeGeneratedId(rawValue, fallback = "item") {
  const fromInput = typeof rawValue === "string" ? rawValue.toLowerCase() : "";
  const normalized = fromInput.replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  if (!normalized) {
    return fallback;
  }
  if (!/^[a-z0-9]/.test(normalized)) {
    return `${fallback}-${normalized}`;
  }
  return normalized;
}

export function makeUniqueId(baseId, seenIds) {
  if (!seenIds.has(baseId)) {
    seenIds.add(baseId);
    return baseId;
  }
  let suffix = 2;
  while (seenIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  const nextId = `${baseId}-${suffix}`;
  seenIds.add(nextId);
  return nextId;
}

export function prettifyLabel(rawValue, fallback = "Clip") {
  const normalized = typeof rawValue === "string" ? rawValue.replace(/[_-]+/g, " ").trim() : "";
  if (!normalized) {
    return fallback;
  }
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isAudioFile(file) {
  if (!file || typeof file.name !== "string") {
    return false;
  }
  if (typeof file.type === "string" && file.type.startsWith("audio/")) {
    return true;
  }
  const { extension } = splitFileNameParts(file.name);
  return AUDIO_EXTENSIONS.has(extension);
}

export function ensureSoundIdsExist(soundIds, referencedId, fieldName) {
  assert(typeof referencedId === "string" && referencedId.trim(), `${fieldName} is required`);
  assert(soundIds.has(referencedId), `${fieldName} references unknown sound id "${referencedId}"`);
}

export function toCustomPresetId(packId, soundId) {
  return `custom:${packId}:${soundId}`;
}

export function toCustomProfileId(packId, profileId) {
  return `custom:${packId}:${profileId}`;
}
