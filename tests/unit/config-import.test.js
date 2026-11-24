import { describe, expect, it, vi } from "vitest";
import { commitConfigImport, prepareConfigImport } from "../../src/lib/configImport.js";

describe("configuration import", () => {
  it("keeps this installation's login setting and scheduler intent", () => {
    const state = { launchAtLogin: true, schedulerRequested: false };
    const normalizeState = vi.fn((input) => ({ ...input, running: false }));
    const candidate = prepareConfigImport({ state: { launchAtLogin: false, schedulerRequested: true, masterVolume: 0.4 } }, {
      state, createDefaultState: () => ({}), normalizeState, presets: [], profileIds: []
    });
    expect(candidate).toMatchObject({ launchAtLogin: true, schedulerRequested: false, masterVolume: 0.4 });
    expect(state).toEqual({ launchAtLogin: true, schedulerRequested: false });
  });

  it("does not alter live configuration or stop a running scheduler if persistence fails", () => {
    const state = { running: true, masterVolume: 0.8 };
    const candidate = { running: false, masterVolume: 0.2 };
    const saveState = vi.fn(() => false);
    const stopScheduler = vi.fn();
    expect(() => commitConfigImport(candidate, { state, saveState, stopScheduler, shouldStop: true })).toThrow(/could not save/i);
    expect(state).toEqual({ running: true, masterVolume: 0.8 });
    expect(stopScheduler).not.toHaveBeenCalled();
    expect(saveState).toHaveBeenCalledWith(candidate);
  });

  it("commits before stopping and preserves current resume intent", () => {
    const state = { running: true, schedulerRequested: true, masterVolume: 0.8 };
    const candidate = { running: false, schedulerRequested: true, masterVolume: 0.2 };
    const saveState = vi.fn(() => { expect(state.masterVolume).toBe(0.8); return true; });
    const stopScheduler = vi.fn((options) => {
      expect(state.masterVolume).toBe(0.2);
      expect(options).toEqual({ preserveRequest: true });
    });
    commitConfigImport(candidate, { state, saveState, stopScheduler, shouldStop: true });
    expect(stopScheduler).toHaveBeenCalledOnce();
    expect(state).toEqual(candidate);
  });
});
