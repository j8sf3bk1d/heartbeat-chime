import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_PALETTE_ID,
  normalizeThemeMode,
  normalizeThemePaletteId,
  resolveAppliedMode
} from "../../src/lib/themes.js";

describe("theme helpers", () => {
  it("normalizes invalid mode and palette to defaults", () => {
    expect(normalizeThemeMode("unknown")).toBe(DEFAULT_THEME_MODE);
    expect(normalizeThemePaletteId("unknown")).toBe(DEFAULT_THEME_PALETTE_ID);
  });

  it("resolves system mode to light/dark from preference", () => {
    expect(resolveAppliedMode("system", true)).toBe("dark");
    expect(resolveAppliedMode("system", false)).toBe("light");
    expect(resolveAppliedMode("light", true)).toBe("light");
  });
});
