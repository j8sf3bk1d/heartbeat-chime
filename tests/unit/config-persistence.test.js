import { describe, expect, it, vi } from "vitest";
import { createStatePersistence } from "../../src/lib/configState.js";

function makeStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

const options = {
  createDefaultState: () => ({ volume: 1 }),
  soundProfiles: [], presets: {},
  normalizeState: (value) => value
};

describe("configuration persistence recovery", () => {
  it("keeps corrupt bytes in a separate recovery copy before saving and reopens its notice", () => {
    const storage = makeStore({ config: "{broken" });
    const onStatus = vi.fn();
    const persistence = createStatePersistence({ storageKey: "config", getStorage: () => storage, onStatus });
    expect(persistence.load(options)).toEqual({ volume: 1 });
    const recoveryKey = storage.getItem("config-recovery-latest");
    expect(storage.getItem(recoveryKey)).toBe("{broken");
    expect(persistence.save({ volume: 0.5 })).toBe(true);
    expect(storage.getItem("config")).toBe('{"volume":0.5}');
    const reopened = createStatePersistence({ storageKey: "config", getStorage: () => storage, onStatus });
    expect(reopened.load(options)).toEqual({ volume: 0.5 });
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ recovery: { key: recoveryKey, raw: "{broken" }, canDismiss: true }));
    expect(reopened.dismissRecovery()).toBe(true);
    expect(storage.getItem(recoveryKey)).toBe("{broken");
  });

  it("blocks every save if a recovery copy cannot be stored", () => {
    const storage = makeStore({ config: "{broken" });
    storage.setItem = () => { throw new Error("quota"); };
    const onStatus = vi.fn();
    const persistence = createStatePersistence({ storageKey: "config", getStorage: () => storage, onStatus });
    expect(persistence.load(options)).toEqual({ volume: 1 });
    expect(persistence.save({ volume: 0.5 })).toBe(false);
    expect(storage.getItem("config")).toBe("{broken");
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ recovery: expect.objectContaining({ raw: "{broken" }), canDismiss: false }));
  });

  it("reports inaccessible storage and subsequent write failures without throwing", () => {
    const onStatus = vi.fn();
    const unavailable = createStatePersistence({ storageKey: "config", getStorage: () => { throw new Error("denied"); }, onStatus });
    expect(unavailable.load(options)).toEqual({ volume: 1 });
    expect(unavailable.save({})).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringMatching(/cannot access/) }));
    const storage = makeStore({ config: '{"volume":0.3}' });
    const persistence = createStatePersistence({ storageKey: "config", getStorage: () => storage, onStatus });
    expect(persistence.load(options)).toEqual({ volume: 0.3 });
    storage.setItem = () => { throw new Error("quota"); };
    expect(persistence.save({ volume: 0.7 })).toBe(false);
    expect(storage.getItem("config")).toBe('{"volume":0.3}');
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringMatching(/could not save/) }));
  });
});
