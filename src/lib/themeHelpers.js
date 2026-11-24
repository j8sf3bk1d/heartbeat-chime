export function getThemeModeLabel(themeMode) {
  if (themeMode === "system") {
    return "System";
  }
  if (themeMode === "light") {
    return "Light";
  }
  return "Dark";
}

const voiceOptionSignatures = new WeakMap();

export function renderVoiceOptions({ ttsSpeaker, groupVoicesByLanguage, ttsVoiceElement, selectedVoiceUri }) {
  const voices = ttsSpeaker.listVoices();
  const voiceGroups = groupVoicesByLanguage(voices);
  const signature = JSON.stringify(voiceGroups.map((group) => [group.label, group.voices.map((voice) => [voice.voiceUri, voice.optionLabel])]));
  if (voiceOptionSignatures.get(ttsVoiceElement) !== signature) {
    ttsVoiceElement.textContent = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Browser Default Voice";
    ttsVoiceElement.append(defaultOption);

    for (const group of voiceGroups) {
      const optGroup = document.createElement("optgroup");
      optGroup.label = group.label;
      for (const voice of group.voices) {
        const option = document.createElement("option");
        option.value = voice.voiceUri;
        option.textContent = voice.optionLabel;
        optGroup.append(option);
      }
      ttsVoiceElement.append(optGroup);
    }
    voiceOptionSignatures.set(ttsVoiceElement, signature);
  }

  if (selectedVoiceUri && voices.some((voice) => voice.voiceURI === selectedVoiceUri)) {
    ttsVoiceElement.value = selectedVoiceUri;
  } else {
    ttsVoiceElement.value = "";
  }
}

export function applyThemeToDocument({ state, resolveAppliedMode, prefersDarkQuery }) {
  const appliedMode = resolveAppliedMode(state.themeMode, prefersDarkQuery.matches);
  document.body.dataset.themeMode = appliedMode;
  document.body.dataset.themePalette = state.themePaletteId;
}
