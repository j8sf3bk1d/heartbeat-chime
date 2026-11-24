// User overrides live in configuration, including empty arrays which clear a
// built-in suggestion. An absent override leaves the source metadata intact.
export function normalizeSoundIntervalTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((n) => Number.isInteger(n) && n > 0 && n <= 10080))].sort((a, b) => a - b);
}

export function normalizeSoundIntervalOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = Object.create(null);
  for (const [id, tags] of Object.entries(value)) {
    if (id && Array.isArray(tags)) result[id] = normalizeSoundIntervalTags(tags);
  }
  return result;
}

export function soundIntervalTags(preset, overrides = {}) {
  if (Object.hasOwn(overrides, preset.id)) return normalizeSoundIntervalTags(overrides[preset.id]);
  return normalizeSoundIntervalTags(preset.intervalMinutes ? [preset.intervalMinutes] : []);
}

export function parseSoundIntervalInput(text) {
  const parts = text.trim() ? text.trim().split(/\s*,\s*/) : [];
  if (parts.some((part) => !/^\d+$/.test(part) || +part < 1 || +part > 10080)) return null;
  return normalizeSoundIntervalTags(parts.map(Number));
}
