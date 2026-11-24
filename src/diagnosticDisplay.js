import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/diagnostic.css";
import { createDiagnosticModel, formatDiagnosticTime } from "./lib/diagnosticDisplayModel.js";

const clock = document.getElementById("clock"), pulse = document.getElementById("pulse");
const lines = document.getElementById("lines"), state = document.getElementById("state"), cueLine = document.getElementById("cue");
let latestGeneration = -1;
const model = createDiagnosticModel();
document.getElementById("drag-handle").addEventListener("mousedown", (event) => {
  if (event.button === 0) void getCurrentWindow().startDragging().catch(() => {});
});
function tick() {
  const now = Date.now();
  clock.textContent = formatDiagnosticTime(now);
  pulse.dataset.on = String(Math.floor(now / 500) % 2 === 0);
  requestAnimationFrame(tick);
}
tick();
void listen("heartbeat://diagnostic-timing", ({ payload }) => {
  const result = model.accept(payload);
  if (!result) return;
  state.textContent = result.state;
  lines.textContent = result.lines.join("\n");
}).catch(() => { state.textContent = "timing events unavailable"; });

void listen("heartbeat://diagnostic-cue", ({ payload }) => {
  if (!payload || !Number.isSafeInteger(payload.generation) || payload.generation < latestGeneration) return;
  latestGeneration = payload.generation;
  const take = payload.take ? `take ${payload.take}` : "take n/a";
  const origin = payload.targetAtMs ? "scheduled" : "preview";
  cueLine.textContent = `${origin} · requested ${payload.expression} · ${take}\n${payload.text}\n${payload.lineId || payload.presetId || "unknown clip"}\nRequested pack: ${payload.character} (${payload.characterId === "builtin" ? "builtin" : String(payload.characterId || "").slice(10,18)})`;
}).catch(() => { cueLine.textContent = "Cue identity unavailable"; });
