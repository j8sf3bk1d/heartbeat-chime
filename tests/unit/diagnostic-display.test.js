import { describe, expect, it } from "vitest";
import { createDiagnosticModel, formatDiagnosticTime } from "../../src/lib/diagnosticDisplayModel.js";

describe("diagnostic display", () => {
  it("correlates source, output estimate and completion without mistaking previews for scheduled cues", () => {
    const model = createDiagnosticModel();
    model.accept({ kind: "cue-lifecycle", cueId: 1, contextId: 2, stage: "dispatch", atMs: 1000 });
    const started = model.accept({ kind: "cue-lifecycle", cueId: 1, contextId: 2, stage: "source-start", atMs: 2500, estimatedOutputOffsetMs: 10, targetOffsetMs: null });
    expect(started.state).toBe("cue 1 · ctx 2");
    expect(started.lines[0]).toContain("preview");
    expect(started.lines[2]).toContain(formatDiagnosticTime(2510));
    const done = model.accept({ kind: "cue-lifecycle", cueId: 1, contextId: 2, stage: "source-ended", atMs: 5000 });
    expect(done.lines[2]).toContain(formatDiagnosticTime(5000));
    expect(model.accept({ kind: "cue-lifecycle", cueId: 0, contextId: 1, stage: "dispatch", atMs: 6000 })).toBeNull();
    const next = model.accept({ kind: "cue-lifecycle", cueId: 2, contextId: 3, stage: "source-start", atMs: 10000, targetOffsetMs: 20, estimatedOutputOffsetMs: 8 });
    expect(next.lines[0]).toContain(formatDiagnosticTime(9980));
    const native = model.accept({ kind: "cue-lifecycle", cueId: 3, contextId: 0, backend: "native", stage: "source-start", atMs: 12000 });
    expect(native.state).toBe("cue 3 · native");
    expect(next.lines[2]).not.toContain(formatDiagnosticTime(5000));
  });
});
