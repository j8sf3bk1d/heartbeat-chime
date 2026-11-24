export function formatDiagnosticTime(atMs) {
  if (!Number.isFinite(atMs)) return "--:--:--.---";
  const date = new Date(atMs);
  if (!Number.isFinite(date.getTime())) return "--:--:--.---";
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
export function createDiagnosticModel() {
  let cueId = -1, contextId = 0, stages = new Map(), refresh = "", backend = "";
  const time = (stage) => formatDiagnosticTime(stages.get(stage)?.atMs);
  return {
    accept(event) {
      if (!event || !Number.isFinite(event.atMs)) return null;
      if (event.kind === "context-refresh") {
        refresh = `refresh ${event.result || "unknown"}`;
        if (cueId < 0) contextId = event.contextId;
      } else if (event.kind === "cue-lifecycle" && Number.isInteger(event.cueId)) {
        if (event.cueId < cueId) return null;
        if (event.cueId > cueId) { cueId = event.cueId; stages = new Map(); backend = event.backend || ""; }
        contextId = event.contextId;
        const old = stages.get(event.stage);
        if (!old || old.atMs <= event.atMs) stages.set(event.stage, event);
      } else return null;
      const source = stages.get("source-start");
      const estimated = Number.isFinite(source?.estimatedOutputOffsetMs) ? source.atMs + source.estimatedOutputOffsetMs : null;
      const target = Number.isFinite(source?.targetOffsetMs) ? source.atMs - source.targetOffsetMs : null;
      return { state: cueId < 0 ? refresh || "waiting for cue" : `cue ${cueId} · ${backend || `ctx ${contextId}`}`,
        lines: [
          `TARGET  ${formatDiagnosticTime(target)}   ${target === null ? "preview" : "scheduled"}`,
          `REQUEST ${time("play-request")}   SOURCE ${time("source-start")}`,
          `EST OUT ${formatDiagnosticTime(estimated)}   END ${time("source-ended")}`,
          `DISPATCH ${time("dispatch")}   ${refresh}`
        ] };
    }
  };
}
