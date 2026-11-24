import { escapeHtml } from "./escapeHtml.js";
import { soundIntervalTags } from "./soundIntervals.js";

export function createModelHelpers({ state, customLibrary, presets, soundProfiles }) {
  function isBuiltInPresetId(presetId) {
    return presets.some((preset) => preset.id === presetId);
  }

  function getAllPresets() {
    return [...presets, ...customLibrary.presets];
  }

  function getAllProfiles() {
    return [...soundProfiles, ...customLibrary.profiles];
  }

  function hasPresetId(presetId) {
    return getAllPresets().some((preset) => preset.id === presetId) && !customLibrary.missingPresetIds?.has(presetId);
  }

  function getPresetById(presetId) {
    return getAllPresets().find((preset) => preset.id === presetId) || null;
  }

  function getPresetLabel(presetId) {
    const preset = getPresetById(presetId);
    if (customLibrary.missingPresetIds?.has(presetId)) return `Missing audio (${preset?.label || presetId})`;
    return preset?.label || (presetId?.startsWith("custom:") ? `Missing sound (${presetId})` : "Cue");
  }

  function getProfileById(profileId) {
    return getAllProfiles().find((profile) => profile.id === profileId) || null;
  }

  function getCurrentProfile() {
    return getProfileById(state.selectedProfileId) || soundProfiles[0];
  }

  function getRelativeDefaultPresetId() {
    const presetId = getCurrentProfile().relativeDefaultPresetId || "soft_chime";
    return hasPresetId(presetId) ? presetId : "soft_chime";
  }

  function getAbsoluteDefaultPresetId() {
    const presetId = getCurrentProfile().absoluteDefaultPresetId || "grand_bell";
    return hasPresetId(presetId) ? presetId : "grand_bell";
  }

  function getPackLabel(packId) {
    return customLibrary.packs.find((pack) => pack.id === packId)?.label || packId || "Imported";
  }

  function groupPresetsBySource(availablePresets) {
    const grouped = new Map();
    for (const preset of availablePresets) {
      const builtIn = isBuiltInPresetId(preset.id);
      const groupKey = builtIn ? (preset.sourceTheme ? `theme:${preset.sourceTheme}` : "__built-in__") : `pack:${preset.packId || "imported"}`;
      const groupLabel = builtIn ? (preset.sourceTheme ? `Theme: ${preset.sourceTheme}` : "Built-in") : `Imported: ${getPackLabel(preset.packId)}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          key: groupKey,
          label: groupLabel,
          presets: []
        });
      }
      grouped.get(groupKey).presets.push(preset);
    }
    const groups = [...grouped.values()];
    groups.sort((a, b) => {
      if (a.key === "__built-in__") {
        return -1;
      }
      if (b.key === "__built-in__") {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });
    for (const group of groups) {
      group.presets.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
    }
    return groups;
  }

  function makePresetOptions(selectedId) {
    const availablePresets = getAllPresets();
    const options = groupPresetsBySource(availablePresets).map((group) => {
      const groupOptions = group.presets
        .map((preset) => `<option value="${escapeHtml(preset.id)}"${selectedId === preset.id ? " selected" : ""}>${escapeHtml(getPresetLabel(preset.id))}</option>`)
        .join("");
      return `<optgroup label="${escapeHtml(group.label)}">${groupOptions}</optgroup>`;
    });
    if (selectedId && !availablePresets.some((preset) => preset.id === selectedId)) {
      options.push(`<option value="${escapeHtml(selectedId)}" selected>Missing Preset (${escapeHtml(selectedId)})</option>`);
    }
    return options.join("");
  }

  function makePresetSetOptions(selectedIds = [], filterMinutes = null) {
    const selectedSet = new Set(selectedIds);
    const availablePresets = getAllPresets();
    const groups = groupPresetsBySource(availablePresets)
      .map((group) => {
        const groupOptions = group.presets
          .filter((preset) => !filterMinutes || selectedSet.has(preset.id) || soundIntervalTags(preset, state.soundIntervalTags).includes(filterMinutes))
          .map((preset) => `<option value="${escapeHtml(preset.id)}"${selectedSet.has(preset.id) ? " selected" : ""}>${escapeHtml(getPresetLabel(preset.id))}</option>`)
          .join("");
        return `<optgroup label="${escapeHtml(group.label)}">${groupOptions}</optgroup>`;
      })
      .join("");
    const missing = selectedIds.filter((id) => !availablePresets.some((preset) => preset.id === id));
    return groups + missing.map((id) => `<option value="${escapeHtml(id)}" selected>Missing sound (${escapeHtml(id)})</option>`).join("");
  }

  return {
    isBuiltInPresetId,
    getAllPresets,
    getAllProfiles,
    hasPresetId,
    getPresetById,
    getPresetLabel,
    getProfileById,
    getCurrentProfile,
    getRelativeDefaultPresetId,
    getAbsoluteDefaultPresetId,
    makePresetOptions,
    makePresetSetOptions
  };
}
