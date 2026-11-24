import { expect, test } from "@playwright/test";
import { createSineWavBuffer } from "./helpers/audio.js";

test("audio timing history persists, preserves older flags, and excludes clip names", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('test-legacy-seeded')) {
      localStorage.setItem('heartbeat.audio-timing-anomalies.v1', JSON.stringify([{ reason: 'clock-divergence', atMs: 100, valueMs: 77000 }]));
      localStorage.setItem('test-legacy-seeded', 'yes');
    }
    AudioContext.prototype.getOutputTimestamp = () => null;
    Object.defineProperty(AudioContext.prototype, "baseLatency", { configurable: true, get: () => 0.8 });
  });
  await page.goto("/#settings");
  await page.getByText("Audio timing diagnostics", { exact: true }).click();
  const enabled = page.getByLabel("Record audio timing");
  const output = page.locator("#audio-diagnostics-output");
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await page.getByRole("link", { name: "Sounds", exact: true }).click();
  await page.locator("#quick-pack-label").fill("Private pack");
  await page.locator("#quick-pack-files").setInputFiles({ name: "private-clip.wav", mimeType: "audio/wav", buffer: createSineWavBuffer({ frequency: 440 }) });
  await page.locator("#quick-pack-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator("#quick-pack-status")).toContainText("Imported 1 clip");
  await page.getByRole("link", { name: "Chimes", exact: true }).click();
  const interval = page.locator('.interval-row[data-interval-id="interval-5"]');
  await interval.locator(".interval-preset").selectOption({ label: "Private Clip" });
  await interval.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.locator("#audio-diagnostics-status")).toHaveText("Recording: 1 sample.");
  await expect(page.locator("#audio-anomalies-status")).toContainText("1 older flags retained.");
  await expect.poll(async () => JSON.parse(await page.locator("#audio-anomalies-output").inputValue()).events.some((event) => event.reasons?.includes("estimated-output-delay"))).toBe(true);
  expect(await page.locator("#audio-anomalies-output").inputValue()).not.toContain("Private");
  const sampleText = await output.inputValue();
  expect(JSON.parse(sampleText).samples).toHaveLength(1);
  expect(sampleText).not.toContain("Private");
  await page.getByRole("button", { name: "Select samples to copy" }).click();
  await expect(output).toBeFocused();
  await enabled.uncheck();
  await expect(output).toHaveValue("");
  await page.reload();
  await page.getByText("Audio timing diagnostics", { exact: true }).click();
  await expect(enabled).not.toBeChecked();
  await expect(page.locator("#audio-anomalies-status")).toContainText("1 older flags retained.");
  await expect.poll(async () => JSON.parse(await page.locator("#audio-anomalies-output").inputValue()).events.some((event) => event.reasons?.includes("estimated-output-delay"))).toBe(true);
  await page.getByRole("button", { name: "Clear preview and older flags" }).click();
  await expect(page.locator("#audio-anomalies-status")).toHaveText("Showing 0 recent timeline entries; 0 older flags retained.");
  await page.reload();
  await page.getByText("Audio timing diagnostics", { exact: true }).click();
  await expect(page.locator("#audio-anomalies-status")).toHaveText("Showing 0 recent timeline entries; 0 older flags retained.");
});

test('timing store prunes expired records on demand and bounds its recent preview', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createAudioTimingStore } = await import('/src/lib/audioTimingStore.js');
    const day = 24 * 60 * 60 * 1000;
    let now = 40 * day;
    const store = createAudioTimingStore({ now: () => now });
    await store.append({ atMs: now - 29 * day, marker: 'old' });
    await store.append({ atMs: now, marker: 'current' });
    const preview = await store.list(1);
    now += 2 * day;
    await store.prune();
    const all = await store.list();
    return { preview: preview.map((row) => row.marker), all: all.map((row) => row.marker) };
  });
  expect(result).toEqual({ preview: ['current'], all: ['current'] });
});
