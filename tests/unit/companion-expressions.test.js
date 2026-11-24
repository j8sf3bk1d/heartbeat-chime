import { describe, expect, it } from "vitest";
import { COMPANION_EXPRESSIONS, companionPortraits, createPortraitFrameLoader, isCompanionExpression } from "../../src/lib/companionExpressions.js";
import { createCompanionMotion } from "../../src/lib/companionMotion.js";

describe("companion expression assets", () => {
  it("recognizes only the eight stable expression IDs", () => {
    expect(COMPANION_EXPRESSIONS).toEqual(["neutral", "smug", "flustered", "hmph", "caring", "impressed", "exasperated", "delighted"]);
    for (const name of COMPANION_EXPRESSIONS) expect(isCompanionExpression(name)).toBe(true);
    for (const invalid of [null, "", "HMPh", "unknown", "../neutral"]) expect(isCompanionExpression(invalid)).toBe(false);
  });

  it("shows each available base portrait and falls back safely when new art is missing", () => {
    const portraits = companionPortraits({
      "./assets/companion/neutral.png": "neutral-url",
      "./assets/companion/hmph.png": "hmph-url",
      "./assets/companion/hmph-blink.png": "hmph-blink-url",
      "./assets/companion/caring-blink.png": "orphan-blink-url",
    });
    expect(portraits.hmph.neutral).toBe("hmph-url");
    expect(portraits.caring.neutral).toBe("neutral-url");
    // Facial variants are installed only after the matching base and a
    // successful async decode, never borrowed from another expression.
    expect(portraits.hmph.blink).toBeUndefined();
    expect(portraits.caring.blink).toBeUndefined();

    const root = { dataset: {}, offsetWidth: 600 };
    const image = { dataset: {}, src: "" };
    const motion = createCompanionMotion({ root, image, dialogue: {}, measure: {}, portraits, reducedMotion: () => true });
    motion.render({ sequence: 1, expression: "hmph", text: "Hmph." });
    expect(image.src).toBe("hmph-url");
    motion.render({ sequence: 2, expression: "caring", text: "Take care." });
    expect(image.src).toBe("neutral-url");
    motion.render({ sequence: 3, expression: "unexpected", text: "Hello." });
    expect(image.src).toBe("neutral-url");
    motion.dispose();
  });

  it("decodes only the current expression and ignores late frames from prior cues", async () => {
    const files = {
      "./assets/companion/neutral.png": "neutral",
      "./assets/companion/neutral-blink.png": "neutral-blink",
      "./assets/companion/neutral-talk.png": "neutral-talk",
      "./assets/companion/hmph.png": "hmph",
      "./assets/companion/hmph-blink.png": "hmph-blink",
      "./assets/companion/hmph-talk.png": "hmph-talk",
      "./assets/companion/caring-talk.png": "orphan",
    };
    const portraits = companionPortraits(files);
    const pending = new Map();
    const ready = [];
    const loader = createPortraitFrameLoader({
      imageFiles: files,
      portraits,
      decode: (url) => ({ ready: new Promise((resolve) => pending.set(url, resolve)) }),
      onReady: (expression) => ready.push(expression),
    });
    loader.activate("neutral");
    expect([...pending.keys()]).toEqual(["neutral-blink", "neutral-talk"]);
    loader.activate("neutral");
    expect(pending.size).toBe(2);
    loader.activate("hmph");
    pending.get("neutral-blink")();
    pending.get("hmph-blink")();
    await Promise.resolve();
    expect(portraits.neutral.blink).toBeUndefined();
    expect(portraits.hmph.blink).toBe("hmph-blink");
    expect(ready).toEqual(["hmph"]);
    loader.activate("caring"); // no base artwork: don't load an orphan layer
    pending.get("hmph-talk")();
    await Promise.resolve();
    expect(portraits.hmph.blink).toBeUndefined();
    expect(portraits.hmph.talk).toBeUndefined();
    expect(pending.has("orphan")).toBe(false);
  });
});
