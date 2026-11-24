import { parseSoundIntervalInput } from "./soundIntervals.js";

function formatImportSummary(importResult) {
  if (!importResult || typeof importResult !== "object") {
    return "";
  }
  const newAssets = Number(importResult.newAssetCount) || 0;
  const reusedAssets = Number(importResult.reusedExistingAssetCount) || 0;
  const dedupedWithinImport = Number(importResult.dedupedWithinImportCount) || 0;
  return `(${newAssets} new asset${newAssets === 1 ? "" : "s"}, ${reusedAssets} reused, ${dedupedWithinImport} deduped in import)`;
}

export function registerLibraryHandlers({
  soundLibraryBrowser,
  state,
  saveState,
  presetSearch,
  presetSourceFilter,
  presetIntervalFilter,
  presetLibrary,
  packImportForm,
  packFiles,
  quickPackForm,
  quickPackLabel,
  quickPackFiles,
  quickPackStatus,
  packList,
  renderPresetLibrary,
  renderIntervals,
  soundEngine,
  getMasterVolume,
  isAudioStoreAvailable,
  buildSoundPackFromFiles,
  buildSoundPackFromAudioFiles,
  saveSoundPack,
  hydrateCustomLibrary,
  deleteSoundPack,
  addLog
}) {
  async function savePackWithReplacementChoice(bundle) {
    try {
      return await saveSoundPack(bundle);
    } catch (error) {
      if (error?.name !== "SoundPackConflictError") throw error;
      const replace = window.confirm(
        `A sound pack named "${error.packLabel}" already uses the ID "${error.packId}". ` +
        "Replace it with the selected pack? Sounds removed from the pack will no longer be available."
      );
      if (!replace) return null;
      return saveSoundPack(bundle, { replaceExisting: true });
    }
  }

  if (soundLibraryBrowser) {
    soundLibraryBrowser.addEventListener("toggle", () => {
      state.soundLibraryExpanded = soundLibraryBrowser.open;
      saveState();
    });
  }

  presetSearch.addEventListener("input", () => {
    renderPresetLibrary();
  });

  presetSourceFilter.addEventListener("change", () => {
    renderPresetLibrary();
  });

  presetIntervalFilter.addEventListener("change", () => renderPresetLibrary());
  presetLibrary.addEventListener("change", (event) => {
    const input = event.target;
    if (!input.classList.contains("preset-interval-input")) return;
    const intervals = parseSoundIntervalInput(input.value);
    if (!intervals) {
      input.setCustomValidity("Use whole minutes from 1 to 10080, separated by commas.");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    state.soundIntervalTags ||= {};
    state.soundIntervalTags[input.dataset.presetId] = intervals;
    saveState();
    renderPresetLibrary();
    renderIntervals();
  });

  presetLibrary.addEventListener("click", async (event) => {
    if (!event.target.classList.contains("preset-preview")) {
      return;
    }
    const presetId = event.target.dataset.presetId;
    await soundEngine.unlock();
    soundEngine.setMasterVolume(getMasterVolume());
    soundEngine.playPreset(presetId, 0.85);
  });

  packImportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAudioStoreAvailable()) {
      addLog("Pack import is unavailable in this browser.");
      return;
    }
    try {
      const bundle = await buildSoundPackFromFiles(packFiles.files);
      const importResult = await savePackWithReplacementChoice(bundle);
      if (!importResult) {
        addLog("Sound pack import canceled; existing pack kept.");
        return;
      }
      await hydrateCustomLibrary({ announceErrors: true });
      packImportForm.reset();
      addLog(`Imported sound pack: ${bundle.pack.label} ${formatImportSummary(importResult)}`.trim());
    } catch (error) {
      addLog(`Pack import failed: ${error.message}`);
    }
  });

  quickPackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAudioStoreAvailable()) {
      quickPackStatus.textContent = "Sound storage is unavailable here, so clips could not be imported.";
      addLog("Clip import is unavailable in this browser.");
      return;
    }
    quickPackStatus.textContent = "Importing clips…";
    try {
      const bundle = await buildSoundPackFromAudioFiles(quickPackFiles.files, {
        packLabel: quickPackLabel.value
      });
      const importResult = await savePackWithReplacementChoice(bundle);
      if (!importResult) {
        quickPackStatus.textContent = "Import canceled; existing pack kept.";
        return;
      }
      await hydrateCustomLibrary({ announceErrors: true });
      quickPackForm.reset();
      quickPackStatus.textContent = `Imported ${bundle.presets.length} clip${bundle.presets.length === 1 ? "" : "s"} into ${bundle.pack.label}. Choose them in the recurring chime Sound menus below.`;
      addLog(`Imported quick clip bundle: ${bundle.pack.label} ${formatImportSummary(importResult)}`.trim());
    } catch (error) {
      quickPackStatus.textContent = `Import failed: ${error.message}`;
      addLog(`Quick clip import failed: ${error.message}`);
    }
  });

  packList.addEventListener("click", async (event) => {
    const packId = event.target.dataset.packId;
    if (!packId || !event.target.classList.contains("pack-delete")) {
      return;
    }
    try {
      await deleteSoundPack(packId);
      await hydrateCustomLibrary({ announceErrors: true });
      addLog(`Removed sound pack: ${packId}`);
    } catch (error) {
      addLog(`Unable to remove pack: ${error.message}`);
    }
  });
}
