export const TTS_RATE_MIN = 0.7;
export const TTS_RATE_MAX = 1.3;
export const TTS_VOLUME_MIN = 0;
export const TTS_VOLUME_MAX = 1;

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

export function isTtsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function clampTtsRate(rate) {
  return clamp(Number.isFinite(rate) ? rate : 1, TTS_RATE_MIN, TTS_RATE_MAX);
}

export function clampTtsVolume(volume) {
  return clamp(Number.isFinite(volume) ? volume : 0.8, TTS_VOLUME_MIN, TTS_VOLUME_MAX);
}

export function resolveTtsText({ label, customText, speakLabel }) {
  const trimmedCustom = typeof customText === "string" ? customText.trim() : "";
  if (trimmedCustom) {
    return trimmedCustom;
  }
  if (speakLabel && typeof label === "string") {
    return label.trim();
  }
  return "";
}

export function createTtsSpeaker() {
  if (!isTtsSupported()) {
    return {
      supported: false,
      speak() {},
      listVoices() {
        return [];
      }
    };
  }

  return {
    supported: true,
    speak({ text, voiceUri, rate = 1, volume = 0.8 }) {
      if (!text || !text.trim()) {
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text.trim());
      utterance.rate = clampTtsRate(rate);
      utterance.volume = clampTtsVolume(volume);
      if (voiceUri) {
        const voices = window.speechSynthesis.getVoices();
        const matching = voices.find((voice) => voice.voiceURI === voiceUri);
        if (matching) {
          utterance.voice = matching;
        }
      }
      window.speechSynthesis.speak(utterance);
    },
    listVoices() {
      return window.speechSynthesis.getVoices();
    }
  };
}

export function shouldSpeakCue({
  ttsEnabled,
  cueType,
  ttsRecurringEnabled,
  ttsOneShotEnabled,
  itemTtsEnabled = true
}) {
  if (!ttsEnabled || !itemTtsEnabled) {
    return false;
  }
  if (cueType === "recurring") {
    return Boolean(ttsRecurringEnabled);
  }
  if (cueType === "one-shot") {
    return Boolean(ttsOneShotEnabled);
  }
  return false;
}

function normalizeVoiceLanguageTag(languageTag) {
  if (typeof languageTag !== "string") {
    return "und";
  }
  const trimmed = languageTag.trim();
  if (!trimmed) {
    return "und";
  }
  return trimmed.replace("_", "-");
}

function resolveLanguageGroupKey(languageTag) {
  const normalized = normalizeVoiceLanguageTag(languageTag);
  if (normalized === "und") {
    return "und";
  }
  return normalized.split("-")[0].toLowerCase();
}

function resolveLanguageGroupLabel(languageKey) {
  if (languageKey === "und") {
    return "Unknown";
  }
  if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
    const displayNames = new Intl.DisplayNames(undefined, { type: "language" });
    const translated = displayNames.of(languageKey);
    if (translated) {
      return translated;
    }
  }
  return languageKey.toUpperCase();
}

function compareVoices(left, right) {
  const langComparison = left.languageTag.localeCompare(right.languageTag, undefined, { sensitivity: "base" });
  if (langComparison !== 0) {
    return langComparison;
  }
  const nameComparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (nameComparison !== 0) {
    return nameComparison;
  }
  return left.voiceUri.localeCompare(right.voiceUri, undefined, { sensitivity: "base" });
}

export function groupVoicesByLanguage(rawVoices) {
  const voices = Array.isArray(rawVoices) ? rawVoices : [];
  const seenVoiceUris = new Set();
  const groupsByLanguage = new Map();

  for (const voice of voices) {
    const voiceUri = typeof voice?.voiceURI === "string" ? voice.voiceURI.trim() : "";
    if (!voiceUri || seenVoiceUris.has(voiceUri)) {
      continue;
    }
    seenVoiceUris.add(voiceUri);

    const languageTag = normalizeVoiceLanguageTag(voice?.lang);
    const languageKey = resolveLanguageGroupKey(languageTag);
    const name = typeof voice?.name === "string" && voice.name.trim() ? voice.name.trim() : "Voice";
    const optionLabel = `${name} (${languageTag})${voice?.default ? " • Default" : ""}`;

    if (!groupsByLanguage.has(languageKey)) {
      groupsByLanguage.set(languageKey, {
        key: languageKey,
        label: resolveLanguageGroupLabel(languageKey),
        voices: []
      });
    }
    groupsByLanguage.get(languageKey).voices.push({
      voiceUri,
      languageTag,
      name,
      optionLabel
    });
  }

  return [...groupsByLanguage.values()]
    .map((group) => ({
      ...group,
      voices: group.voices.sort(compareVoices)
    }))
    .sort((left, right) => {
      const labelComparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
      if (labelComparison !== 0) {
        return labelComparison;
      }
      return left.key.localeCompare(right.key, undefined, { sensitivity: "base" });
    });
}
