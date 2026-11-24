import { clamp } from "./state.js";

export function computeTimerProgressRatio(timer, nowMs = Date.now()) {
  if (!timer || !timer.active) {
    return 1;
  }
  const startAtMs = Number(timer.createdAtMs);
  const targetAtMs = Number(timer.targetAtMs);
  if (!Number.isFinite(startAtMs) || !Number.isFinite(targetAtMs) || targetAtMs <= startAtMs) {
    return 0;
  }
  const elapsed = nowMs - startAtMs;
  const total = targetAtMs - startAtMs;
  return clamp(elapsed / total, 0, 1);
}
