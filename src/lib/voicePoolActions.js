// Adding the current bundled voices is an explicit additive action: custom
// selections, ordering, weights, and playback strategy stay under user control.
export function missingBundledVoiceIds(interval, selectedIds, voiceSet) {
  const available = voiceSet?.intervalPresetByMinutes?.[interval?.minutes];
  if (!Array.isArray(available)) return [];
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return available.filter((id) => !selected.has(id));
}
