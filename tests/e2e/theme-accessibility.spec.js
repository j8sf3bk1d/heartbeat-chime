import { expect, test } from "@playwright/test";
import { openDetails, readSurfaceLuminance } from "./helpers/ui.js";

test("theme, dark surfaces, and keyboard focus styles", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Heartbeat Chime" })).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Theme mode").selectOption("dark");
  await page.getByLabel("Theme palette").selectOption("ember");
  await expect(page.locator("body")).toHaveAttribute("data-theme-mode", "dark");
  await expect(page.locator("body")).toHaveAttribute("data-theme-palette", "ember");

  const darkSurfaceCheck = await readSurfaceLuminance(page, [".interval-row", ".timer-form", ".preset-item", ".log-list"]);
  for (const surface of darkSurfaceCheck) {
    expect(surface.exists).toBe(true);
    expect(surface.luminance).toBeLessThan(120);
  }

  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Start Chimes" })).toBeFocused();
  const focusStyle = await page.evaluate(() => {
    const button = document.getElementById("toggle-engine");
    if (!button) {
      return { outlineStyle: "none", outlineWidth: "0px" };
    }
    const style = window.getComputedStyle(button);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);
});

test("tts panel exposes expected controls", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await openDetails(page.locator("#tts-settings-panel"));
  await expect(page.getByLabel("Global TTS enabled")).toBeVisible();
  await page.getByLabel("Global TTS enabled").check();
  await page.getByLabel("Speak recurring cues").check();
  await page.getByLabel("Speak one-shot timers").check();
  await page.getByLabel("Speak event label when no custom text").check();
  await page.getByLabel("Speak this text (optional)").fill("Time checkpoint");
  await expect(page.getByRole("button", { name: "Test voice" })).toBeVisible();
  await expect(page.getByLabel("Speech volume")).toBeVisible();
});

test("sound library collapse state persists across reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sounds", exact: true }).click();
  const library = page.locator("#sound-library-browser");
  await expect(library).toHaveJSProperty("open", false);

  await library.locator("summary").click();
  await expect(library).toHaveJSProperty("open", true);
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("heartbeat-state-v1");
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw);
    return parsed.soundLibraryExpanded === true;
  });
  await page.reload();
  await expect(page.locator("#sound-library-browser")).toHaveJSProperty("open", true);

  await page.locator("#sound-library-browser summary").click();
  await expect(page.locator("#sound-library-browser")).toHaveJSProperty("open", false);
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem("heartbeat-state-v1");
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw);
    return parsed.soundLibraryExpanded === false;
  });
  await page.reload();
  await expect(page.locator("#sound-library-browser")).toHaveJSProperty("open", false);
});
