// A saved default set may expand once, only when the complete new pack is
// available. Explicit imports remain exact and opt out of this migration.
export function migrateLegacyVoiceDefaults(parsed, intervals, voiceSet, { migrate = false, explicitImport = false } = {}) {
  const priorVersion = parsed?.voiceCoverageMigrationVersion === 2 ? 2 : parsed?.voiceCoverageMigrationVersion === 1 ? 1 : 0;
  // Imports are deliberate snapshots: never expand them on this or later runs.
  if (explicitImport) return { intervals, version: 2 };
  if (!migrate || !voiceSet?.hasCompleteExpressionCoverage) return { intervals, version: priorVersion };
  const targetVersion = voiceSet.hasCompleteFrequencyCoverage ? 2 : 1;
  if (priorVersion >= targetVersion) return { intervals, version: priorVersion };
  if (parsed?.selectedProfileId !== "dry_time_checks") return { intervals, version: targetVersion };

  const savedById = new Map((Array.isArray(parsed.intervals) ? parsed.intervals : []).map((item) => [item?.id, item]));
  const migrated = intervals.map((interval) => {
    const original = voiceSet.legacyIntervalPresetByMinutes?.[interval.minutes] || [];
    const baseline = voiceSet.frequencyBaseIntervalPresetByMinutes?.[interval.minutes] || voiceSet.intervalPresetByMinutes?.[interval.minutes] || [];
    const expanded = voiceSet.intervalPresetByMinutes?.[interval.minutes] || [];
    const saved = savedById.get(interval.id);
    const ids = Array.isArray(saved?.presetIds) ? saved.presetIds : [];
    const weights = saved?.presetWeights;
    const unweighted = weights == null || (typeof weights === "object" && !Array.isArray(weights) && Object.keys(weights).length === 0);
    const matches = (set) => set.length > 0 && ids.length === set.length && new Set(ids).size === set.length &&
      set.every((id) => ids.includes(id)) && set.includes(saved?.presetId);
    const standard = saved?.playbackMode === "random" && unweighted;
    const v1Eligible = priorVersion < 1 && original.length === 10 && matches(original);
    const v2Eligible = priorVersion < 2 && voiceSet.hasCompleteFrequencyCoverage && baseline.length === 22 && matches(baseline);
    if (!standard) return interval;
    if (v1Eligible) return { ...interval, presetIds: [...(targetVersion === 2 ? expanded : baseline)] };
    if (v2Eligible && expanded.length > baseline.length) return { ...interval, presetIds: [...expanded] };
    return interval;
  });
  return { intervals: migrated, version: targetVersion };
}
