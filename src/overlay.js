import { readCompanionDisplayName } from "./lib/companionName.js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { whenDocumentLoaded } from "./lib/companionReady.js";
import { createCompanionMotion } from "./lib/companionMotion.js";
import { companionPortraits, createPortraitFrameLoader, COMPANION_EXPRESSIONS } from "./lib/companionExpressions.js";
import { getCharacterPack, selectedCharacter, CHARACTER_REVISION_KEY } from "./lib/characterStore.js";
import { validateCharacterPack, MASK_KEYS } from "./lib/characterPack.js";
import "./styles/companion.css";

const imageFiles = import.meta.glob("./assets/companion/*.png", { eager: true, query: "?url", import: "default" });
const portraits = companionPortraits(imageFiles);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
let frameLoader;
let activeId = "builtin", activeRevision = null, wantedId = "builtin", characterEpoch = 0, latestSequence = -1, latestGeneration = -1;
function currentRevision() { try { return localStorage.getItem(CHARACTER_REVISION_KEY); } catch { return null; } }
const cache = new Map();
let packDisplayName = "Heartbeat";
function refreshDisplayName() { document.querySelector(".character-name").textContent = readCompanionDisplayName(packDisplayName); }
const motion = createCompanionMotion({
  root: document.querySelector(".companion"),
  image: document.getElementById("portrait"),
  blinkLayer: document.getElementById("portrait-blink"),
  talkLayer: document.getElementById("portrait-talk"),
  dialogue: document.getElementById("dialogue-text"),
  measure: document.getElementById("dialogue-measure"),
  portraits,
  reducedMotion: () => motionPreference.matches,
  onExpressionChange: (expression) => { if (activeId === "builtin") frameLoader.activate(expression); },
});
motionPreference.addEventListener("change", () => motion.preferencesChanged());
// Load only the active expression's facial frames. The static base remains
// visible if decoding fails or is still in flight.
function makeFrameLoader() { return createPortraitFrameLoader({
  imageFiles,
  portraits,
  onReady: () => motion.refreshPortrait(),
  decode: (url) => {
    const image = new Image();
    image.src = url;
    const ready = typeof image.decode === "function" ? image.decode() : new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    return { image, ready };
  },
}); }
frameLoader = makeFrameLoader();

function setCharacter(id, pack, revision = null) {
  // Invalidate pending decodes before replacing the shared portrait table.
  if (activeId === "builtin") frameLoader.activate(null);
  activeId = id; activeRevision = revision;
  const next = pack ? Object.fromEntries(COMPANION_EXPRESSIONS.map((id) => {
    const frame = pack.frames[id] || pack.frames.neutral;
    return [id, { neutral: frame.base, ...(pack.frames[id]?.blink ? {blink:frame.blink} : {}), ...(pack.frames[id]?.talk ? {talk:frame.talk} : {}) }];
  })) : companionPortraits(imageFiles);
  for (const id of COMPANION_EXPRESSIONS) portraits[id] = next[id];
  for (const key of MASK_KEYS) {
    if (pack) document.documentElement.style.setProperty(`--${key}`, `${pack.masks[key]}%`);
    else document.documentElement.style.removeProperty(`--${key}`);
  }
  if (pack) document.documentElement.style.setProperty("--portrait-ratio", `${pack.canvas.width} / ${pack.canvas.height}`);
  else document.documentElement.style.removeProperty("--portrait-ratio");
  packDisplayName = pack?.name || "Heartbeat";
  refreshDisplayName();
  if (!pack) frameLoader = makeFrameLoader();
  motion.refreshPortrait();
  if (pack) {
    const image = new Image();
    image.onload = () => { if (activeId === id) void invoke("overlay_character_loaded", { characterId:id }).catch(() => {}); };
    image.src = pack.frames.neutral.base;
  }
}
function preload(id, revision = currentRevision()) {
  if (id === "builtin") return Promise.resolve(null);
  const cached = cache.get(id);
  if (cached?.revision === revision) return Promise.resolve(cached.pack);
  return getCharacterPack(id).then(pack => {
    if (!pack || currentRevision() !== revision) return null;
    const clean = validateCharacterPack(pack);
    cache.clear(); cache.set(id, {revision, pack:clean});
    return clean;
  }).catch(() => null);
}
function renderCue(cue, options) {
  if (!cue || !Number.isSafeInteger(cue.sequence) || cue.sequence < latestSequence) return;
  latestSequence = cue.sequence;
  if (Number.isSafeInteger(cue.generation)) latestGeneration = cue.generation;
  const id = typeof cue.characterId === "string" ? cue.characterId : "builtin";
  const revision = currentRevision();
  wantedId = id;
  const epoch = ++characterEpoch;
  if (id !== activeId || (id !== "builtin" && revision !== activeRevision)) {
    const cached = cache.get(id);
    const ready = cached?.revision === revision ? cached.pack : null;
    if (id === "builtin" || ready) setCharacter(id, ready || null, revision);
    else {
      // Never hold up a cue or its audio while a large pack loads.
      setCharacter("builtin", null);
      void preload(id, revision).then(pack => { if (pack && currentRevision() === revision && epoch === characterEpoch && wantedId === id) setCharacter(id, pack, revision); });
    }
  }
  refreshDisplayName();
  motion.render(cue, options);
}
void preload(selectedCharacter());
window.addEventListener("storage", (event) => {
  if (!event.key || event.key === CHARACTER_REVISION_KEY || event.key === "heartbeat.character.selected.v1") void preload(selectedCharacter());
});

// Install the listener before requesting the latest cue, so a very early cue
// is neither lost nor rendered twice if the two messages race.
void (async () => {
  try {
    await listen("heartbeat://overlay-cue", (event) => renderCue(event.payload));
    await listen("heartbeat://overlay-timing", (event) => motion.extend(event.payload));
    await listen("heartbeat://overlay-speech", (event) => motion.speech(event.payload));
    await listen("heartbeat://overlay-clear", (event) => { if (!Number.isSafeInteger(event.payload?.generation) || event.payload.generation >= latestGeneration) characterEpoch++; motion.clear(event.payload); });
    await listen("heartbeat://overlay-motion-preference", (event) => motion.setCharacterMotion(event.payload));
    await whenDocumentLoaded();
    renderCue(await invoke("overlay_ready"), { snapshot: true });
  } catch (error) {
    console.warn("Unable to initialize companion overlay:", error);
  }
})();
