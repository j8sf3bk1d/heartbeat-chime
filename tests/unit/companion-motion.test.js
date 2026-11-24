import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanionMotion, mouthOpening } from "../../src/lib/companionMotion.js";

function fixture({ reduced = false, preference = () => reduced } = {}) {
  const root = { dataset: {}, offsetWidth: 400 };
  const image = { dataset: {}, src: "" };
  const blinkLayer = { dataset: {}, src: "" };
  const talkLayer = { dataset: {}, src: "" };
  const dialogue = { textContent: "" };
  const measure = { textContent: "" };
  const portraits = {
    neutral: { neutral: "neutral.png", blink: "neutral-blink.png", talk: "neutral-talk.png" },
    smug: { neutral: "smug.png", blink: "smug-blink.png", talk: "smug-talk.png" },
  };
  const motion = createCompanionMotion({ root, image, blinkLayer, talkLayer, dialogue, measure, portraits, reducedMotion: preference, random: () => 0 });
  return { root, image, blinkLayer, talkLayer, dialogue, motion };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => { vi.useRealTimers(); });

describe("companion expression animation", () => {
  it("extends only the active generation for delayed output without changing motion settings", () => {
    const { root, motion } = fixture();
    motion.render({ sequence: 1, generation: 123, text: "Hi", durationMs: 4000, characterMotion: false });
    motion.extend({ generation: 122, startedAtMs: Date.now() + 3000, durationMs: 4000 });
    motion.extend({ generation: 123, startedAtMs: Date.now() + 3000, durationMs: 4000 });
    vi.advanceTimersByTime(4000);
    expect(root.dataset.phase).toBe("enter");
    expect(root.dataset.characterMotion).toBe("false");
    vi.advanceTimersByTime(4350);
    expect(root.dataset.phase).toBe("exit");
    motion.render({ sequence: 2, generation: 124, text: "Next", durationMs: 4000 });
    motion.extend({ generation: 123, startedAtMs: Date.now() + 3000, durationMs: 4000 });
    vi.advanceTimersByTime(3350);
    expect(root.dataset.phase).toBe("exit");
    motion.clear({ generation: 124 });
    motion.extend({ generation: 124, startedAtMs: Date.now(), durationMs: 4000 });
    expect(root.dataset.phase).toBe("hidden");
  });

  it("does not start animations when timing arrives with reduced motion", () => {
    const { root, motion } = fixture({ reduced: true });
    motion.render({ sequence: 1, generation: 123, text: "Hi", durationMs: 4000 });
    motion.extend({ generation: 123, startedAtMs: Date.now() + 3000, durationMs: 4000 });
    expect(root.dataset.phase).toBe("static");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("maps normalized audio energy to bounded mouth openings", () => {
    expect([0, 0.079, 0.08, 0.239, 0.24, 0.479, 0.48, 1, NaN].map(mouthOpening)).toEqual([
      "closed", "closed", "small", "small", "medium", "medium", "wide", "wide", "closed",
    ]);
  });
  it("blinks using the selected expression and clears timers on hide", () => {
    const { root, image, blinkLayer, motion } = fixture();
    motion.render({ sequence: 1, generation: 123, expression: "smug", text: "Hi", durationMs: 10000 });
    expect(image.src).toBe("smug.png");
    vi.advanceTimersByTime(2200);
    expect(image.src).toBe("smug.png");
    expect(blinkLayer.src).toBe("smug-blink.png");
    expect(blinkLayer.dataset.active).toBe("true");
    vi.advanceTimersByTime(140);
    expect(blinkLayer.dataset.active).toBe("false");
    motion.clear({ generation: 123 });
    expect(root.dataset.phase).toBe("hidden");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(image.src).toBe("smug.png");
  });

  it("uses the actual cue's audio envelope and rejects stale events", () => {
    const { image, blinkLayer, talkLayer, motion } = fixture();
    motion.render({ sequence: 1, generation: 123, expression: "smug", text: "Hi", durationMs: 10000 });
    motion.speech({ generation: 122, startedAtMs: Date.now(), frameMs: 40, levels: [1, 0] });
    expect(image.src).toBe("smug.png");
    motion.speech({ generation: 123, startedAtMs: Date.now(), frameMs: 40, levels: [1, 0] });
    expect(image.src).toBe("smug.png");
    expect(talkLayer.src).toBe("smug-talk.png");
    expect(talkLayer.dataset.active).toBe("true");
    vi.advanceTimersByTime(40);
    expect(talkLayer.dataset.active).toBe("false");
    vi.advanceTimersByTime(80);
    expect(image.dataset.face).toBe("neutral");
    motion.clear({ generation: 122 });
    expect(image.src).toBe("smug.png");
    vi.advanceTimersByTime(2100);
    expect(blinkLayer.dataset.active).toBe("true");
    motion.clear({ generation: 123 });
  });

  it("updates opening size as the selected voice level changes and closes for silence", () => {
    const { talkLayer, motion } = fixture();
    motion.render({ sequence: 1, generation: 123, text: "Hi", durationMs: 10000 });
    motion.speech({ generation: 123, startedAtMs: Date.now(), frameMs: 40, levels: [0.1, 0.3, 0.6, 0] });
    expect(talkLayer.dataset.opening).toBe("small");
    vi.advanceTimersByTime(40);
    expect(talkLayer.dataset.opening).toBe("medium");
    vi.advanceTimersByTime(40);
    expect(talkLayer.dataset.opening).toBe("wide");
    vi.advanceTimersByTime(40);
    expect(talkLayer.dataset.opening).toBe("closed");
    expect(talkLayer.dataset.active).toBe("false");
    motion.clear({ generation: 123 });
  });

  it("keeps full text and no motion in reduced-motion mode", () => {
    const { root, image, dialogue, motion } = fixture({ reduced: true });
    motion.render({ sequence: 1, generation: 123, text: "No refunds.", durationMs: 4000 });
    expect(root.dataset.phase).toBe("static");
    expect(dialogue.textContent).toBe("No refunds.");
    motion.speech({ generation: 123, startedAtMs: Date.now(), frameMs: 40, levels: [1] });
    vi.advanceTimersByTime(3000);
    expect(image.dataset.face).toBe("neutral");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops an active mouth, blink and text animation when reduced motion is enabled", () => {
    let reduced = false;
    const { root, image, dialogue, motion } = fixture({ preference: () => reduced });
    motion.render({ sequence: 1, generation: 123, text: "No refunds.", durationMs: 10000 });
    motion.speech({ generation: 123, startedAtMs: Date.now(), frameMs: 40, levels: [1, 1, 1] });
    expect(image.dataset.face).toBe("talk");
    reduced = true;
    motion.preferencesChanged();
    expect(image.dataset.face).toBe("neutral");
    expect(root.dataset.phase).toBe("static");
    expect(dialogue.textContent).toBe("No refunds.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows independent masked blink and mouth, and immediately honors motion toggle", () => {
    const { root, image, blinkLayer, talkLayer, motion } = fixture();
    motion.render({ sequence: 1, generation: 123, expression: "smug", text: "Hi", durationMs: 10000 });
    vi.advanceTimersByTime(2200);
    motion.speech({ generation: 123, startedAtMs: Date.now(), frameMs: 40, levels: [1, 1, 1] });
    expect(image.src).toBe("smug.png");
    expect(blinkLayer.dataset.active).toBe("true");
    expect(talkLayer.dataset.active).toBe("true");
    expect(image.dataset.face).toBe("blink-talk");
    motion.setCharacterMotion({ enabled: false, revision: 7 });
    expect(root.dataset.characterMotion).toBe("false");
    expect(blinkLayer.dataset.active).toBe("false");
    expect(talkLayer.dataset.active).toBe("false");
    motion.setCharacterMotion({ enabled: true, revision: 6 });
    vi.advanceTimersByTime(3000);
    expect(blinkLayer.dataset.active).toBe("false");
    motion.clear({ generation: 123 });
  });

  it("does not let an older cue override a newer live preference", () => {
    const { root, blinkLayer, motion } = fixture();
    motion.setCharacterMotion({ enabled: false, revision: 10 });
    motion.render({ sequence: 1, generation: 123, motionRevision: 9, characterMotion: true, text: "Hi", durationMs: 10000 });
    expect(root.dataset.characterMotion).toBe("false");
    vi.advanceTimersByTime(2400);
    expect(blinkLayer.dataset.active).toBe("false");
    motion.clear({ generation: 123 });
  });

  it("replaces animations safely and rejects malformed envelopes", () => {
    const { image, blinkLayer, motion } = fixture();
    motion.render({ sequence: 1, generation: 123, expression: "smug", text: "Old", durationMs: 4000 });
    motion.speech({ generation: 123, startedAtMs: Date.now(), frameMs: 40, levels: [2] });
    expect(image.src).toBe("smug.png");
    motion.render({ sequence: 2, generation: 124, expression: "neutral", text: "New", durationMs: 4000 });
    motion.speech({ generation: 123, startedAtMs: Date.now(), frameMs: 40, levels: [1] });
    expect(image.src).toBe("neutral.png");
    motion.clear({ generation: 123 });
    vi.advanceTimersByTime(2200);
    expect(blinkLayer.src).toBe("neutral-blink.png");
    expect(blinkLayer.dataset.active).toBe("true");
    motion.clear({ generation: 124 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('facial layer decode safety', () => {
  it('waits for image load on webviews without decode', async () => {
    const { createFacialLayer } = await import('../../src/lib/companionMotion.js');
    const layer = {dataset:{}, src:'', addEventListener:() => {}, complete:false};
    const set = createFacialLayer(layer);
    set('first', true);
    expect(layer.dataset.active).toBe('false');
    const oldLoad = layer.onload;
    set('second', true);
    oldLoad();
    expect(layer.dataset.active).toBe('false');
    layer.onload();
    expect(layer.dataset.active).toBe('true');
  });
  it('never exposes the old blink while a new expression is still decoding', async () => {
    const { createFacialLayer } = await import('../../src/lib/companionMotion.js');
    const waits = [];
    const layer = {dataset:{}, src:'', decode:() => new Promise((resolve,reject) => waits.push({resolve,reject}))};
    const set = createFacialLayer(layer);
    set('flustered-blink', true);
    expect(layer.dataset.active).toBe('false');
    waits[0].resolve(); await Promise.resolve();
    expect(layer.dataset.active).toBe('true');
    set('neutral-blink', true);
    expect(layer.dataset.active).toBe('false');
    set('neutral-blink', true);
    expect(layer.dataset.active).toBe('false');
    set('smug-blink', true);
    waits[1].resolve(); await Promise.resolve();
    expect(layer.dataset.active).toBe('false');
    waits[2].resolve(); await Promise.resolve();
    expect(layer.dataset.active).toBe('true');
    set('neutral-blink', true);
    set('', false);
    waits[3].resolve(); await Promise.resolve();
    expect(layer.dataset.active).toBe('false');
  });
});

describe('sustained speech mouth pulses', () => {
  it('pulses only after sustained audio, honors silence, and restarts for a new cue', () => {
    const {motion,talkLayer} = fixture();
    motion.render({sequence:1,generation:1,expression:'smug',text:'Test',durationMs:9000});
    motion.speech({generation:1,startedAtMs:Date.now(),frameMs:40,levels:[...Array(30).fill(1),0,...Array(30).fill(1)]});
    expect(talkLayer.dataset.active).toBe('true');
    vi.advanceTimersByTime(280); expect(talkLayer.dataset.active).toBe('true');
    vi.advanceTimersByTime(40); expect(talkLayer.dataset.active).toBe('false');
    vi.advanceTimersByTime(80); expect(talkLayer.dataset.active).toBe('true');
    vi.advanceTimersByTime(800); expect(talkLayer.dataset.active).toBe('false');
    vi.advanceTimersByTime(40); expect(talkLayer.dataset.active).toBe('true');
    motion.render({sequence:2,generation:2,expression:'smug',text:'New',durationMs:5000});
    motion.speech({generation:2,startedAtMs:Date.now(),frameMs:40,levels:Array(20).fill(1)});
    vi.advanceTimersByTime(280); expect(talkLayer.dataset.active).toBe('true');
    motion.clear({generation:2}); vi.advanceTimersByTime(500);
    expect(talkLayer.dataset.active).toBe('false');
  });
});
