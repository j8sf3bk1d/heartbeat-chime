import { describe, expect, it, vi } from "vitest";
import { whenDocumentLoaded } from "../../src/lib/companionReady.js";

describe("companion native ready barrier", () => {
  it("does not wait if the document already finished loading", async () => {
    const target = { addEventListener: vi.fn() };
    await whenDocumentLoaded({ readyState: "complete" }, target);
    expect(target.addEventListener).not.toHaveBeenCalled();
  });
  it("waits for the window load event if the listener is installed earlier", async () => {
    let onLoad;
    const target = { addEventListener: vi.fn((name, handler) => { expect(name).toBe("load"); onLoad = handler; }) };
    let ready = false;
    const pending = whenDocumentLoaded({ readyState: "interactive" }, target).then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(target.addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
    onLoad();
    await pending;
    expect(ready).toBe(true);
  });
});
