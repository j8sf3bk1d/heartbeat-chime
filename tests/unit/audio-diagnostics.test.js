import { describe, expect, it, vi } from "vitest";
import { createAudioDiagnostics } from "../../src/lib/audioDiagnostics.js";

describe("audio timing diagnostics", () => {
  it("records only after opt-in, omits content, and clears on opt-out", () => {
    let now = 1000;
    const onChange = vi.fn();
    const diagnostics = createAudioDiagnostics({ now: () => now, onChange });
    const ctx = { currentTime: 2, state: "running", baseLatency: 0.02, outputLatency: 0.03,
      getOutputTimestamp: () => ({ contextTime: 1.9, performanceTime: 900, secret: "private words" }),
      filename: "private.mp3" };
    diagnostics.noteContext(ctx);
    diagnostics.record(ctx, 2.01, Date.now() + 50);
    expect(JSON.parse(diagnostics.getText()).samples).toHaveLength(0);
    diagnostics.setEnabled(true);
    now = 1500;
    diagnostics.record(ctx, 2.01, Date.now() + 50);
    const text = diagnostics.getText();
    const sample = JSON.parse(text).samples[0];
    expect(sample).toMatchObject({ contextId: 1, contextAgeMs: 500, contextTimeSec: 2, outputContextTimeSec: 1.9, outputPerformanceMs: 900, baseLatencySec: 0.02, outputLatencySec: 0.03 });
    expect(text).not.toContain("private");
    diagnostics.setEnabled(false);
    expect(JSON.parse(diagnostics.getText()).samples).toHaveLength(0);
  });

  it("keeps a baseline and the latest bounded samples, tolerating unavailable metadata", () => {
    const diagnostics = createAudioDiagnostics({ now: () => 1000, limit: 3 });
    const ctx = { currentTime: 0, state: "running", getOutputTimestamp: () => { throw new Error("unavailable"); } };
    diagnostics.setEnabled(true);
    for (let n = 0; n < 5; n++) { ctx.currentTime = n; diagnostics.record(ctx, n, Date.now()); }
    const samples = JSON.parse(diagnostics.getText()).samples;
    expect(samples.map((sample) => sample.contextTimeSec)).toEqual([0, 3, 4]);
    expect(samples[0].outputContextTimeSec).toBeNull();
  });

  it("retains exactly 100 samples and preserves the first after long sessions", () => {
    const diagnostics = createAudioDiagnostics({ now: () => 1000 });
    const ctx = { currentTime: 0, state: "running" };
    diagnostics.setEnabled(true);
    for (let n = 0; n < 150; n++) { ctx.currentTime = n; diagnostics.record(ctx, n, Date.now()); }
    const samples = JSON.parse(diagnostics.getText()).samples;
    expect(samples).toHaveLength(100);
    expect(samples[0].contextTimeSec).toBe(0);
    expect(samples[1].contextTimeSec).toBe(51);
    expect(samples.at(-1).contextTimeSec).toBe(149);
  });
});
