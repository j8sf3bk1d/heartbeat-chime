export const EXPRESSION_IDS = Object.freeze(["neutral", "smug", "flustered", "hmph", "caring", "impressed", "exasperated", "delighted"]);
export const MASK_KEYS = Object.freeze(["eye-x", "eye-y", "eye-w", "eye-h", "mouth-x", "mouth-y", "mouth-w", "mouth-h"]);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;
const PNG_HEADER = [137,80,78,71,13,10,26,10];

// This is a local design prototype, not an application import contract.
// No URLs, HTML, scripts or archive paths are accepted as image assets.
export function validateCharacterPack(value) {
  if (!value || value.format !== "heartbeat-character-prototype" || value.version !== 1 || typeof value.name !== "string" || !value.name.trim() || value.name.length > 80) throw new Error("Invalid character pack header.");
  const masks = {};
  for (const key of MASK_KEYS) {
    const n = value.masks?.[key];
    if (!Number.isFinite(n) || n < (key.endsWith("-w") || key.endsWith("-h") ? 1 : 0) || n > (key.endsWith("-w") || key.endsWith("-h") ? 50 : 100)) throw new Error(`Invalid mask value: ${key}.`);
    masks[key] = n;
  }
  const frames = {};
  let total = 0, dimensions = null;
  for (const name of EXPRESSION_IDS) {
    const entry = value.frames?.[name];
    if (entry === undefined) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Invalid ${name} frames.`);
    const result = {};
    for (const mode of ["base", "blink", "talk"]) {
      const data = entry[mode];
      if (data === undefined && mode !== "base") continue;
      if (typeof data !== "string" || data.length > MAX_IMAGE_CHARS || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error(`Invalid PNG in ${name} ${mode}.`);
      total += data.length;
      if (total > MAX_BYTES) throw new Error("Character pack is too large.");
      let header;
      try { header = atob(data.slice(22, 62)); } catch { throw new Error(`Invalid PNG encoding in ${name} ${mode}.`); }
      if (PNG_HEADER.some((b,i) => header.charCodeAt(i) !== b) || header.slice(12,16) !== "IHDR") throw new Error(`Invalid PNG header in ${name} ${mode}.`);
      const int32 = (i) => ((header.charCodeAt(i) * 0x1000000) + (header.charCodeAt(i+1) << 16) + (header.charCodeAt(i+2) << 8) + header.charCodeAt(i+3));
      const width = int32(16), height = int32(20);
      if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error(`Invalid image dimensions in ${name} ${mode}.`);
      const size = `${width}x${height}`;
      if (dimensions && dimensions !== size) throw new Error("All frames must use the same canvas dimensions.");
      dimensions = size; result[mode] = data;
    }
    frames[name] = result;
  }
  if (!frames.neutral?.base) throw new Error("A neutral portrait is required.");
  return {format:"heartbeat-character-prototype",version:1,name:value.name.trim(),masks,frames};
}
