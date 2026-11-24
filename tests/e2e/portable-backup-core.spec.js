import { expect, test } from "@playwright/test";

test("portable library restores conflicting pack under fresh IDs with all references and bytes preserved", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { saveSoundPack, getSoundPresetBlob } = await import("/src/lib/audioStore.js");
    const { createDefaultState } = await import("/src/lib/state.js");
    const { createPortableBackup, parsePortableBackup, restorePortableLibrary } = await import("/src/lib/portableBackup.js");
    const id = "custom:test-pack:clip", profileId = "custom:test-pack:default";
    await saveSoundPack({ pack: { id: "test-pack", label: "Backup pack" }, presets: [{ id, packId: "test-pack", label: "Voice", file: new File(["audio-one"], "cue.wav", { type: "audio/wav" }) }], profiles: [{ id: profileId, packId: "test-pack", label: "Profile", relativeDefaultPresetId: id, absoluteDefaultPresetId: id, intervalPresetByMinutes: { 1: id } }] });
    const state = createDefaultState();
    Object.assign(state.intervals[0], { presetId: id, presetIds: [id], presetWeights: { [id]: 7 } });
    state.soundIntervalTags = { [id]: [1, 5] }; state.selectedProfileId = profileId;
    state.oneShots = [{ id: "timer", label: "x", targetAtMs: Date.now() + 60000, presetId: id, presetIds: [id], presetWeights: { [id]: 3 } }];
    const serialized = JSON.stringify(await createPortableBackup(state));
    const parsed = await parsePortableBackup(new File([serialized], "backup.json"));
    const restored = await restorePortableLibrary(parsed);
    const newId = restored.state.intervals[0].presetId;
    return { newId, originalId: id, restoredCount: restored.remapped, interval: restored.state.intervals[0], timer: restored.state.oneShots[0], tags: restored.state.soundIntervalTags, profile: restored.state.selectedProfileId, original: await (await getSoundPresetBlob(id)).text(), copy: await (await getSoundPresetBlob(newId)).text() };
  });
  expect(result.newId).not.toBe(result.originalId);
  expect(result.restoredCount).toBe(1);
  expect(result.interval.presetIds).toEqual([result.newId]);
  expect(result.interval.presetWeights[result.newId]).toBe(7);
  expect(result.timer.presetWeights[result.newId]).toBe(3);
  expect(result.tags[result.newId]).toEqual([1, 5]);
  expect(result.profile).not.toBe("custom:test-pack:default");
  expect(result.original).toBe("audio-one");
  expect(result.copy).toBe("audio-one");
});

test("corrupt or incomplete backups fail before touching the library", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { saveSoundPack, loadSoundLibrary } = await import("/src/lib/audioStore.js");
    const { createDefaultState } = await import("/src/lib/state.js");
    const { createPortableBackup, parsePortableBackup } = await import("/src/lib/portableBackup.js");
    await saveSoundPack({ pack: { id: "p", label: "P" }, presets: [{ id: "custom:p:a", packId: "p", label: "A", file: new File(["audio-one"], "cue.wav") }], profiles: [] });
    const data = await createPortableBackup(createDefaultState());
    data.library.assets[0].data = btoa("audio-two");
    let message;
    try { await parsePortableBackup(new File([JSON.stringify(data)], "broken.json")); } catch (error) { message = error.message; }
    return { message, packs: (await loadSoundLibrary()).packs.map((pack) => pack.id) };
  });
  expect(result.message).toContain("integrity");
  expect(result.packs).toEqual(["p"]);
});

test("large valid audio roundtrips and malformed labels are rejected before writing", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { saveSoundPack, loadSoundLibrary } = await import("/src/lib/audioStore.js");
    const { createDefaultState } = await import("/src/lib/state.js");
    const { createPortableBackup, parsePortableBackup, restorePortableLibrary } = await import("/src/lib/portableBackup.js");
    const bytes = new Uint8Array(8 * 1024 * 1024).fill(42);
    await saveSoundPack({ pack: { id: "big", label: "Big" }, presets: [{ id: "custom:big:a", packId: "big", label: "A", file: new File([bytes], "big.wav") }], profiles: [] });
    const backup = await createPortableBackup(createDefaultState());
    const parsed = await parsePortableBackup(new File([JSON.stringify(backup)], "ok.json"));
    const size = parsed.library.assets[0].blob.size;
    backup.library.packs[0].label = { bad: true };
    let message;
    try { await restorePortableLibrary(await parsePortableBackup(new File([JSON.stringify(backup)], "bad.json"))); } catch (error) { message = error.message; }
    return { size, message, packs: (await loadSoundLibrary()).packs.length };
  });
  expect(result.size).toBe(8 * 1024 * 1024);
  expect(result.message).toContain("Invalid metadata");
  expect(result.packs).toBe(1);
});
