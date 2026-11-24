// Stable manifest and overlay identifiers. Native IPC independently validates
// the same allowlist at the trust boundary.
export const COMPANION_EXPRESSIONS = Object.freeze([
  "neutral", "smug", "flustered", "hmph", "caring", "impressed", "exasperated", "delighted",
]);

export function isCompanionExpression(value) {
  return typeof value === "string" && COMPANION_EXPRESSIONS.includes(value);
}

// Missing artwork must not prevent a cue from displaying while assets are
// added or if an older installation is opened. Never borrow facial frames from
// a different expression: they can visibly jump on top of another portrait.
export function companionPortraits(imageFiles) {
  const path = (expression, suffix = "") => `./assets/companion/${expression}${suffix}.png`;
  const neutral = imageFiles[path("neutral")] || "";
  return Object.fromEntries(COMPANION_EXPRESSIONS.map((expression) => [expression, {
    neutral: imageFiles[path(expression)] || neutral,
  }]));
}

// Full-size animated frames can consume several MiB each after decoding.
// Keep only the active expression's two facial frames ready instead of
// decoding every expression as soon as the overlay starts. A token prevents
// a slower previous expression from attaching frames after a later cue.
export function createPortraitFrameLoader({ imageFiles, portraits, decode, onReady = () => {} }) {
  let active = null;
  let epoch = 0;
  let retained = [];

  function activate(expression) {
    if (active === expression) return;
    if (active && portraits[active]) {
      delete portraits[active].blink;
      delete portraits[active].talk;
    }
    active = expression;
    retained = [];
    const current = ++epoch;
    if (!isCompanionExpression(expression) || !portraits[expression] || !imageFiles[`./assets/companion/${expression}.png`]) return;

    for (const mode of ["blink", "talk"]) {
      const url = imageFiles[`./assets/companion/${expression}-${mode}.png`];
      if (!url) continue;
      try {
        const frame = decode(url);
        retained.push(frame);
        void Promise.resolve(frame.ready).then(() => {
          if (current !== epoch || active !== expression) return;
          portraits[expression][mode] = url;
          onReady(expression);
        }).catch(() => {});
      } catch {
        // Failed decodes are optional; the original portrait remains visible.
      }
    }
  }

  return { activate };
}
