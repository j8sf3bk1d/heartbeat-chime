export const THEME_MODES = ["system", "light", "dark"];

export const THEME_PALETTES = [
  { id: "lilac", label: "Quiet Lilac", description: "Soft neutral surfaces and violet accents." },
  { id: "dawn", label: "Dawn Brass", description: "Warm parchment and teal accents." },
  { id: "tide", label: "Coastal Tide", description: "Cool sky and sea glass accents." },
  { id: "ember", label: "Ember Clay", description: "Earthy neutrals with orange-red accents." }
];

export const DEFAULT_THEME_MODE = "system";
export const DEFAULT_THEME_PALETTE_ID = THEME_PALETTES[0].id;

export function normalizeThemeMode(mode) {
  return THEME_MODES.includes(mode) ? mode : DEFAULT_THEME_MODE;
}

export function normalizeThemePaletteId(paletteId) {
  return THEME_PALETTES.some((palette) => palette.id === paletteId)
    ? paletteId
    : DEFAULT_THEME_PALETTE_ID;
}

export function resolveAppliedMode(themeMode, prefersDarkMode = false) {
  const normalized = normalizeThemeMode(themeMode);
  if (normalized === "system") {
    return prefersDarkMode ? "dark" : "light";
  }
  return normalized;
}
