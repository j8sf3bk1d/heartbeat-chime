import { createFacialLayer } from "../../src/lib/companionMotion.js";
import { EXPRESSION_IDS as expressions, validateCharacterPack } from "./pack.js";
const expression = document.querySelector("#expression");
const blink = document.querySelector("#blink"), mouth = document.querySelector("#mouth");
const base = document.querySelector("#portrait"), eyes = document.querySelector("#portrait-blink"), lips = document.querySelector("#portrait-talk");
const controls = document.querySelector("#mask-controls");
const defaults = {"eye-x":50,"eye-y":33,"eye-w":23,"eye-h":9,"mouth-x":50,"mouth-y":42,"mouth-w":8,"mouth-h":4};
const character = document.querySelector("#character"), status = document.querySelector("#status");
let imported = null;
const draftMasks = { heartbeat: {"eye-x":53,"eye-y":34,"eye-w":18,"eye-h":7,"mouth-x":55,"mouth-y":44,"mouth-w":7,"mouth-h":3.5} };
let replayTimer;
let blinkSource = "", talkSource = "";
const updateBlinkLayer = createFacialLayer(eyes), updateTalkLayer = createFacialLayer(lips);
for (const name of expressions) expression.add(new Option(name, name));
for (const [key,value] of Object.entries(defaults)) {
  const label = document.createElement("label"), input = document.createElement("input");
  label.textContent = key; input.type = "number"; input.min = "0"; input.max = "100"; input.step = ".5"; input.value = value;
  input.addEventListener("input", () => { draftMasks[character.value][key] = Number(input.value); document.documentElement.style.setProperty(`--${key}`, `${input.value}%`); });
  label.append(input); controls.append(label);
}
function setExpression() {
  const path = `/src/assets/companion/neutral`;
  const selected = character.value === "imported" ? imported : null;
  const frame = selected ? (selected.frames[expression.value] || selected.frames.neutral) : null;
  base.src = frame ? frame.base : `${path}.png`;
  const layers = selected ? selected.frames[expression.value] : null;
  blinkSource = selected ? (layers?.blink || "") : "";
  talkSource = selected ? (layers?.talk || "") : "";
  updateBlinkLayer("", false); updateTalkLayer("", false);
  eyes.hidden = !blinkSource; lips.hidden = !talkSource;
  document.querySelector(".character-name").textContent = selected?.name || "Heartbeat";
}
function update() {
  const now = performance.now();
  updateBlinkLayer(blinkSource, blink.value === "on" || blink.value === "auto" && now % 2800 < 180);
  const wiggle = mouth.value === "wiggle" || mouth.value === "blend";
  document.querySelector("#mouth-mask-preview").dataset.wiggle = String(wiggle);
  const opening = mouth.value === "auto" ? ["closed","small","medium","wide","medium"][Math.floor(now / 180) % 5]
    : mouth.value === "steady" ? "wide" : mouth.value === "close-pulse" ? (now % 400 < 80 ? "closed" : "wide") : mouth.value === "blend" ? "medium" : wiggle ? (now % 400 < 80 ? "medium" : "wide") : mouth.value;
  lips.dataset.opening = opening; updateTalkLayer(talkSource, opening !== "closed");
  requestAnimationFrame(update);
}
async function toDataUrl(url) {
  const response = await fetch(url); if (!response.ok) throw new Error("Could not load a sprite.");
  const blob = await response.blob();
  return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read a sprite.")); reader.readAsDataURL(blob); });
}
async function checkImages(pack) {
  for (const frame of Object.values(pack.frames)) for (const data of Object.values(frame)) {
    await new Promise((resolve,reject) => {
      const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error("A PNG could not be decoded.")); image.src = data;
    });
  }
}
function applyMasks() {
  for (const input of controls.querySelectorAll("input")) { const key = input.parentElement.firstChild.textContent; input.value = draftMasks[character.value][key]; document.documentElement.style.setProperty(`--${key}`, `${input.value}%`); }
}
document.querySelector("#export").addEventListener("click", async () => {
  try {
    status.textContent = "Preparing pack…";
    const frames = {};
    if (character.value === "imported") Object.assign(frames, imported.frames);
    else frames.neutral = {base: await toDataUrl("/src/assets/companion/neutral.png")};
    const masks = Object.fromEntries([...controls.querySelectorAll("input")].map(input => [input.parentElement.firstChild.textContent,Number(input.value)]));
    const pack = validateCharacterPack({format:"heartbeat-character-prototype",version:1,name:character.value === "imported" ? imported.name : "Heartbeat",masks,frames});
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack)], {type:"application/json"}));
    const link = document.createElement("a"); link.href = url; link.download = "heartbeat-character-prototype.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Prototype pack exported.";
  } catch (error) { status.textContent = error.message; }
});
const file = document.querySelector("#file");
document.querySelector("#import").addEventListener("click", () => file.click());
file.addEventListener("change", async () => {
  try {
    const chosen = file.files?.[0]; if (!chosen) return;
    if (chosen.size > 64 * 1024 * 1024) throw new Error("Character pack is too large.");
    const pack = validateCharacterPack(JSON.parse(await chosen.text()));
    await checkImages(pack);
    imported = pack;
    draftMasks.imported = {...pack.masks};
    if (![...character.options].some(option => option.value === "imported")) character.add(new Option(pack.name,"imported"));
    character.querySelector('[value="imported"]').textContent = pack.name;
    character.value = "imported";
    applyMasks();
    setExpression(); status.textContent = `Loaded ${pack.name} in the preview.`;
  } catch (error) { status.textContent = `Could not load pack: ${error.message}`; }
  finally { file.value = ""; }
});
character.addEventListener("change",() => { applyMasks(); setExpression(); });
expression.addEventListener("change",setExpression);
document.querySelector("#replay").addEventListener("click", () => {
  const root = document.querySelector(".companion"); clearTimeout(replayTimer);
  root.dataset.phase = "hidden"; void root.offsetWidth; root.dataset.phase = "enter";
  replayTimer = setTimeout(() => { root.dataset.phase = "exit"; }, 4200);
});
applyMasks(); setExpression(); update();
