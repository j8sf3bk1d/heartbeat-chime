import { expect, test } from "@playwright/test";

test("scheduler health refresh preserves an in-progress speech draft", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Start Chimes" }).click();
  await expect(page.locator("#status-text")).toHaveText("Running");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.locator("#tts-settings-panel summary").click();
  const draft = page.getByLabel("Speak this text (optional)");
  await draft.fill("a speech draft still being edited");
  await expect(draft).toBeFocused();
  await page.evaluate(() => {
    window.__sessionOptions = ["sound-profile", "tts-voice", "theme-mode", "theme-palette"]
      .map((id) => document.getElementById(id).firstElementChild);
  });
  // The scheduler refreshes audio health every 15 seconds. Keep the input
  // focused so its ordinary change/blur commit has not yet occurred.
  await page.clock.runFor(16_000);
  await expect(draft).toHaveValue("a speech draft still being edited");
  expect(await page.evaluate(() => ["sound-profile", "tts-voice", "theme-mode", "theme-palette"]
    .every((id, index) => document.getElementById(id).firstElementChild === window.__sessionOptions[index]))).toBe(true);
  await draft.blur();
  await page.reload();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.locator("#tts-settings-panel summary").click();
  await expect(page.getByLabel("Speak this text (optional)")).toHaveValue("a speech draft still being edited");
});

test("an explicit configuration import replaces even a focused speech draft", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.locator("#tts-settings-panel summary").click();
  const draft = page.getByLabel("Speak this text (optional)");
  await draft.fill("in-progress text");
  await expect(draft).toBeFocused();
  const savedState = await page.evaluate(() => JSON.parse(localStorage.getItem("heartbeat-state-v1")));
  savedState.ttsCustomText = "restored text";
  // Set the file through the browser API, without opening an OS file dialog.
  await page.locator("#config-import-file").setInputFiles({
    name: "settings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ state: savedState }))
  });
  await expect(draft).toHaveValue("restored text");
  await page.reload();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.locator("#tts-settings-panel summary").click();
  await expect(page.getByLabel("Speak this text (optional)")).toHaveValue("restored text");
});

test("voice choices update when available voices change without rebuilding unchanged choices", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderVoiceOptions } = await import("/src/lib/themeHelpers.js");
    const select = document.createElement("select");
    let voices = [{ voiceURI: "voice-one", name: "One" }];
    const speaker = { listVoices: () => voices };
    const group = (items) => [{ label: "English", voices: items.map((item) => ({ voiceUri: item.voiceURI, optionLabel: item.name })) }];
    const render = (selectedVoiceUri) => renderVoiceOptions({ ttsSpeaker: speaker, groupVoicesByLanguage: group, ttsVoiceElement: select, selectedVoiceUri });
    render("voice-one");
    const first = select.firstElementChild;
    render("voice-one");
    const unchanged = select.firstElementChild === first && select.value === "voice-one";
    voices = [{ voiceURI: "voice-two", name: "Two <safe>" }];
    render("voice-two");
    return { unchanged, changed: select.firstElementChild !== first, selected: select.value, label: select.selectedOptions[0]?.textContent };
  });
  expect(result).toEqual({ unchanged: true, changed: true, selected: "voice-two", label: "Two <safe>" });
});
