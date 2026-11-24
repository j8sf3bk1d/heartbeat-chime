import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const autostart = vi.hoisted(() => ({ isEnabled: vi.fn(), enable: vi.fn(), disable: vi.fn() }));
const companion = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => autostart);
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => companion);

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  global.window = { __TAURI_INTERNALS__: {} };
});

describe("desktop companion bridge", () => {
  it("forwards placement and dialogue to the native command", async () => {
    companion.invoke.mockResolvedValue(true);
    const { showCompanionOverlay } = await import("../../src/lib/desktopBridge.js");
    const request = { monitorId: "primary", corner: "bottom-right", text: "Hello", expression: "smug", durationMs: 5000 };
    expect(await showCompanionOverlay(request)).toBe(true);
    expect(companion.invoke).toHaveBeenCalledWith("overlay_show", { request });
  });

  it("provides a safe no-op outside the desktop shell", async () => {
    global.window = {};
    const { listOverlayMonitors, hideCompanionOverlay } = await import("../../src/lib/desktopBridge.js");
    expect(await listOverlayMonitors()).toEqual([]);
    expect(await hideCompanionOverlay()).toBe(false);
    expect(companion.invoke).not.toHaveBeenCalled();
  });
});
afterEach(() => { delete global.window; });

describe("desktop autostart bridge", () => {
  it("propagates OS read failures instead of reporting disabled", async () => {
    autostart.isEnabled.mockRejectedValue(new Error("OS read failed"));
    const { getLaunchAtLoginEnabled } = await import("../../src/lib/desktopBridge.js");
    await expect(getLaunchAtLoginEnabled()).rejects.toThrow("OS read failed");
  });

  it("verifies the actual OS setting and reports a refused update", async () => {
    autostart.isEnabled.mockResolvedValue(false);
    const { setLaunchAtLoginEnabled } = await import("../../src/lib/desktopBridge.js");
    await expect(setLaunchAtLoginEnabled(true)).rejects.toThrow("not applied");
    expect(autostart.enable).toHaveBeenCalledTimes(1);
  });

  it("returns a successful disable only after OS verification", async () => {
    autostart.isEnabled.mockResolvedValue(false);
    const { setLaunchAtLoginEnabled } = await import("../../src/lib/desktopBridge.js");
    expect(await setLaunchAtLoginEnabled(false)).toBe(false);
    expect(autostart.disable).toHaveBeenCalledTimes(1);
  });

  it("does not call OS startup APIs from a browser", async () => {
    global.window = {};
    const { setLaunchAtLoginEnabled } = await import("../../src/lib/desktopBridge.js");
    expect(await setLaunchAtLoginEnabled(true)).toBe(false);
    expect(autostart.enable).not.toHaveBeenCalled();
  });
});
