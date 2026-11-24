import { test, expect } from "@playwright/test";

async function installMotion(page) {
  await page.goto("/overlay.html");
  await page.evaluate(async () => {
    const { createCompanionMotion } = await import("/src/lib/companionMotion.js");
    window.__motion = createCompanionMotion({
      root: document.querySelector(".companion"),
      image: document.querySelector("#portrait"),
      dialogue: document.querySelector("#dialogue-text"),
      measure: document.querySelector("#dialogue-measure"),
      portraits: { neutral: "/src/assets/companion/neutral.png" },
      reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  });
}

test("cue reveals text, exits, and replacement cancels old animation", async ({ page }) => {
  await installMotion(page);
  const root = page.locator(".companion");
  const text = page.locator("#dialogue-text");
  await page.evaluate(() => window.__motion.render({ sequence: 1, text: "Another minute gone.", durationMs: 1100 }));
  await expect(root).toHaveAttribute("data-phase", "enter");
  await page.waitForTimeout(500);
  await expect(text).toHaveText("");
  await expect(text).toHaveText("Another minute gone.", { timeout: 2000 });
  await page.evaluate(() => window.__motion.render({ sequence: 2, text: "Not getting that back.", durationMs: 3000 }));
  await page.waitForTimeout(1800);
  await expect(root).toHaveAttribute("data-phase", "enter");
  await expect(text).toHaveText("Not getting that back.");
  await page.evaluate(() => window.__motion.render({ sequence: 1, text: "Stale", durationMs: 1000 }));
  await expect(text).toHaveText("Not getting that back.");
  await expect(root).toHaveAttribute("data-phase", "exit", { timeout: 4000 });
});

test("scheduled dialogue begins at its cue target instead of a fixed entrance delay", async ({ page }) => {
  await installMotion(page);
  await page.evaluate(() => {
    const target = Date.now() + 350;
    window.__motion.render({ sequence: 1, generation: 10, text: "At the target.", durationMs: 5000, targetAtMs: target });
    window.__motion.extend({ generation: 10, startedAtMs: target, durationMs: 1000 });
  });
  await page.waitForTimeout(150);
  await expect(page.locator("#dialogue-text")).toHaveText("");
  await expect(page.locator("#dialogue-text")).not.toHaveText("", { timeout: 1000 });
});

test("dialogue follows a later audio estimate instead of the missed target", async ({ page }) => {
  await installMotion(page);
  await page.evaluate(() => {
    const now = Date.now();
    window.__motion.render({ sequence: 1, generation: 10, text: "Wait for the sound.", durationMs: 5000, targetAtMs: now + 200 });
    window.__motion.extend({ generation: 10, startedAtMs: now + 700, durationMs: 1000 });
  });
  await page.waitForTimeout(400);
  await expect(page.locator("#dialogue-text")).toHaveText("");
  await expect(page.locator("#dialogue-text")).not.toHaveText("", { timeout: 1000 });
});

test("reduced motion and a recovered snapshot show full dialogue immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMotion(page);
  await page.evaluate(() => window.__motion.render({ sequence: 1, text: "No refunds.", durationMs: 4000 }, { snapshot: true }));
  await expect(page.locator("#dialogue-text")).toHaveText("No refunds.");
  await page.evaluate(() => window.__motion.render({ sequence: 1, text: "No refunds.", durationMs: 4000 }));
  await expect(page.locator(".companion")).toHaveAttribute("data-phase", "static");
  await expect(page.locator("#dialogue-text")).toHaveText("No refunds.");
});

test("breathing stays continuous while the portrait slides out", async ({ page }) => {
  await installMotion(page);
  const result = await page.evaluate(() => {
    window.__motion.render({ sequence: 1, text: "No refunds.", durationMs: 12000 });
    const root = document.querySelector(".companion");
    const stack = document.querySelector(".portrait-stack");
    // Freeze a visibly non-default point in the cycle so this does not depend
    // on frame scheduling or merely catch the animation at scale(1).
    const breathing = stack.getAnimations().find((animation) => animation.animationName === "character-breathe");
    if (!breathing) throw new Error("Breathing animation did not start");
    breathing.pause();
    breathing.currentTime = 1900;
    const before = getComputedStyle(stack).transform;
    root.dataset.phase = "exit";
    const after = getComputedStyle(stack).transform;
    const afterAnimation = stack.getAnimations().find((animation) => animation.animationName === "character-breathe");
    const shellAnimation = document.querySelector(".portrait-shell").getAnimations().some((animation) => animation.animationName === "character-out");
    return { before, after, sameAnimation: breathing === afterAnimation, shellAnimation };
  });
  expect(result.before).not.toBe("none");
  expect(result.before).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  expect(result.after).toBe(result.before);
  expect(result.sameAnimation).toBe(true);
  expect(result.shellAnimation).toBe(true);
});

test("system reduced motion suppresses breathing even before preference state catches up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMotion(page);
  const result = await page.evaluate(() => {
    const root = document.querySelector(".companion");
    root.dataset.phase = "enter";
    root.dataset.characterMotion = "true";
    return getComputedStyle(document.querySelector(".portrait-stack")).animationName;
  });
  expect(result).toBe("none");
});
