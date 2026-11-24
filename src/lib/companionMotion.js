// The native window owns visibility and cue expiry. This controller only
// animates the currently displayed cue, and never changes playback timing.
export function mouthOpening(level) {
  if (!Number.isFinite(level) || level < 0.08) return "closed";
  if (level < 0.24) return "small";
  if (level < 0.48) return "medium";
  return "wide";
}

// Browsers can keep displaying an image's old decoded pixels while its src is
// changing. Do not expose a new layer until that exact image has decoded.
export function createFacialLayer(layer) {
  let source = null, serial = 0, ready = false, wanted = false;
  return (url, enabled) => {
    if (!layer) return;
    wanted = Boolean(enabled && url);
    if (!wanted) { layer.dataset.active = "false"; return; }
    if (source !== url) {
      source = url; ready = false;
      const current = ++serial;
      layer.dataset.active = "false";
      layer.src = url;
      const markReady = () => {
        if (current !== serial || source !== url) return;
        if (layer.currentSrc && layer.currentSrc !== layer.src) return;
        ready = true;
        if (wanted) layer.dataset.active = "true";
      };
      if (typeof layer.decode === "function") {
        let decode;
        try { decode = layer.decode(); } catch { return; }
        void Promise.resolve(decode).then(markReady).catch(() => {});
      } else if (typeof layer.addEventListener === "function") {
        // Older webviews without decode() still must wait for the load event.
        layer.onload = markReady;
        if (layer.complete && layer.naturalWidth > 0) markReady();
      } else { ready = true; } // Lightweight non-DOM test doubles.
    }
    layer.dataset.active = String(ready && wanted);
  };
}

export function createCompanionMotion({ root, image, blinkLayer, talkLayer, dialogue, measure, portraits, reducedMotion = () => false, random = Math.random, onExpressionChange = () => {} }) {
  const updateBlinkLayer = createFacialLayer(blinkLayer);
  const updateTalkLayer = createFacialLayer(talkLayer);
  let newest = -1;
  let animated = -1;
  let generation = null;
  let expression = "neutral";
  let currentText = "";
  let characterMotion = true;
  let preferenceRevision = -1;
  let blinking = false;
  let opening = "closed";
  let alive = false;
  let typeTimer;
  let typeStartTimer;
  let targetTimedText = false;
  let exitTimer;
  let exitAt = 0;
  let blinkTimer;
  let blinkEndTimer;
  let speechTimer;

  function updatePortrait() {
    const set = portraits[expression] || portraits.neutral;
    const base = typeof set === "string" ? set : set?.neutral || "";
    if (image.getAttribute?.("src") !== base) image.src = base;
    const showBlink = Boolean(blinking && typeof set !== "string" && set?.blink);
    const showTalk = Boolean(opening !== "closed" && typeof set !== "string" && set?.talk);
    // Full-frame generations differ outside the face. Render masked eye and
    // mouth layers over the stable base so both motions can coexist without
    // making hair or clothing shimmer between frames.
    updateBlinkLayer(set?.blink, showBlink);
    if (talkLayer) talkLayer.dataset.opening = opening;
    updateTalkLayer(set?.talk, showTalk);
    image.dataset.face = showBlink && showTalk ? "blink-talk" : showBlink ? "blink" : showTalk ? "talk" : "neutral";
  }

  function scheduleBlink() {
    if (!alive || !characterMotion || reducedMotion()) return;
    blinkTimer = setTimeout(() => {
      if (!alive || !characterMotion || reducedMotion()) return;
      blinking = true;
      updatePortrait();
      blinkEndTimer = setTimeout(() => {
        blinking = false;
        updatePortrait();
        scheduleBlink();
      }, 140);
    }, 2200 + Math.round(random() * 2600));
  }

  function cancelTimers() {
    clearInterval(typeTimer);
    clearTimeout(typeStartTimer);
    clearTimeout(exitTimer);
    clearTimeout(blinkTimer);
    clearTimeout(blinkEndTimer);
    clearInterval(speechTimer);
    typeTimer = undefined;
    typeStartTimer = undefined;
    targetTimedText = false;
    exitTimer = undefined;
    exitAt = 0;
    blinkTimer = undefined;
    blinkEndTimer = undefined;
    speechTimer = undefined;
    blinking = false;
    opening = "closed";
  }

  function scheduleTypewriter(delay, chars, typeDuration) {
    clearTimeout(typeStartTimer);
    typeStartTimer = setTimeout(() => {
      typeStartTimer = undefined;
      const start = performance.now();
      typeTimer = setInterval(() => {
        const progress = Math.min(1, (performance.now() - start) / typeDuration);
        dialogue.textContent = chars.slice(0, Math.ceil(chars.length * progress)).join("");
        if (progress >= 1) { clearInterval(typeTimer); typeTimer = undefined; }
      }, 30);
    }, Math.max(0, delay));
  }

  function render(payload, { snapshot = false } = {}) {
    if (!payload || !Number.isSafeInteger(payload.sequence) || payload.sequence < newest) return;
    if (payload.sequence === newest && (snapshot || animated === payload.sequence)) return;
    cancelTimers();
    newest = payload.sequence;
    generation = Number.isSafeInteger(payload.generation) ? payload.generation : null;
    // A preference toggle may overtake a cue through IPC; never let its older
    // snapshot re-enable animation after a newer explicit user choice.
    const cueRevision = Number.isSafeInteger(payload.motionRevision) ? payload.motionRevision : -1;
    if (cueRevision >= preferenceRevision) {
      preferenceRevision = cueRevision;
      characterMotion = payload.characterMotion !== false;
    }
    root.dataset.characterMotion = String(characterMotion && !reducedMotion());
    expression = Object.hasOwn(portraits, payload.expression) ? payload.expression : "neutral";
    onExpressionChange(expression);
    alive = !snapshot;
    updatePortrait();
    const text = typeof payload.text === "string" ? payload.text.slice(0, 500) : "";
    currentText = text;
    measure.textContent = text;

    // A ready snapshot covers a reloaded already-visible window. The actual
    // cue event follows readiness for a fresh show and starts motion then.
    if (snapshot || reducedMotion()) {
      dialogue.textContent = text;
      root.dataset.phase = "static";
      if (!snapshot) animated = payload.sequence;
      return;
    }

    animated = payload.sequence;
    dialogue.textContent = "";
    // Reset the same CSS animation on replacement, even in the same frame.
    root.dataset.phase = "hidden";
    void root.offsetWidth;
    root.dataset.phase = "enter";
    scheduleBlink();
    const chars = Array.from(text);
    const typeDuration = Math.min(1200, Math.max(250, chars.length * 24));
    // Prefer the actual scheduled-audio estimate delivered in extend(). A
    // bounded fallback still reveals text if that optional event is lost.
    targetTimedText = Number.isSafeInteger(payload.targetAtMs);
    const typeDelay = targetTimedText ? Math.max(0, Math.min(5000, payload.targetAtMs - Date.now())) : 1000;
    scheduleTypewriter(typeDelay + (targetTimedText ? 1000 : 0), chars, typeDuration);
    const duration = Number.isFinite(payload.durationMs) ? payload.durationMs : 4000;
    scheduleExit(Math.max(typeDelay + typeDuration + 500, duration - 650));
  }

  function scheduleExit(delay) {
    const deadline = performance.now() + delay;
    if (deadline <= exitAt) return;
    clearTimeout(exitTimer);
    exitAt = deadline;
    exitTimer = setTimeout(() => {
      alive = false;
      clearTimeout(blinkTimer);
      clearTimeout(blinkEndTimer);
      clearInterval(speechTimer);
      blinking = false;
      opening = "closed";
      updatePortrait();
      clearInterval(typeTimer);
      typeTimer = undefined;
      dialogue.textContent = currentText;
      root.dataset.phase = "exit";
    }, delay);
  }

  function extend(payload) {
    if (!alive || reducedMotion() || root.dataset.phase === "static" || generation === null || payload?.generation !== generation ||
        !Number.isSafeInteger(payload.startedAtMs) || Math.abs(payload.startedAtMs - Date.now()) > 5000 ||
        !Number.isSafeInteger(payload.durationMs) || payload.durationMs < 1 || payload.durationMs > 30000) return;
    if (targetTimedText && typeStartTimer !== undefined) {
      const chars = Array.from(currentText);
      const typeDuration = Math.min(1200, Math.max(250, chars.length * 24));
      scheduleTypewriter(Math.max(0, payload.startedAtMs - Date.now()), chars, typeDuration);
      targetTimedText = false;
    }
    // Leave the same two-second reading grace as the native visibility timer.
    scheduleExit(Math.max(0, payload.startedAtMs - Date.now() + payload.durationMs + 2000 - 650));
  }

  function speech(payload) {
    if (!alive || !characterMotion || reducedMotion() || generation === null || payload?.generation !== generation ||
        !Number.isFinite(payload.startedAtMs) || !Number.isFinite(payload.frameMs) || payload.frameMs < 20 || payload.frameMs > 1000 ||
        !Array.isArray(payload.levels) || payload.levels.length === 0 || payload.levels.length > 600 ||
        payload.levels.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return;
    clearInterval(speechTimer);
    // A fresh per-envelope cadence; real silence always wins. Use elapsed cue
    // time so delayed timers never accumulate drift across sound events.
    let sustainedAt = null, pulseAt = null, pulseUntil = null;
    const pick = (low, range) => low + Math.floor(Math.max(0, Math.min(0.999999, random())) * range);
    const update = () => {
      const elapsed = Date.now() - payload.startedAtMs;
      const frame = Math.floor(elapsed / payload.frameMs);
      if (!alive || !characterMotion || reducedMotion() || frame >= payload.levels.length) {
        clearInterval(speechTimer);
        speechTimer = undefined;
        opening = "closed";
        updatePortrait();
        return;
      }
      let nextOpening = frame >= 0 ? mouthOpening(payload.levels[frame]) : "closed";
      if (nextOpening === "closed") {
        sustainedAt = pulseAt = pulseUntil = null;
      } else {
        if (sustainedAt === null) {
          sustainedAt = elapsed;
          pulseAt = sustainedAt + pick(300, 201);
        }
        if (pulseUntil !== null && elapsed >= pulseUntil) {
          pulseUntil = null;
          pulseAt = elapsed + pick(300, 201);
        } else if (pulseUntil === null && elapsed >= pulseAt) {
          pulseUntil = elapsed + pick(60, 41);
        }
        if (pulseUntil !== null) nextOpening = "closed";
      }
      if (nextOpening !== opening) { opening = nextOpening; updatePortrait(); }
    };
    update();
    if (alive && Date.now() - payload.startedAtMs < payload.frameMs * payload.levels.length) speechTimer = setInterval(update, 40);
  }

  function clear(payload) {
    // Native clear is generation-scoped; delayed clears must not hide a new cue.
    if (payload && generation !== null && Number.isSafeInteger(payload.generation) && payload.generation < generation) return;
    alive = false;
    cancelTimers();
    updatePortrait();
    root.dataset.phase = "hidden";
  }

  function preferencesChanged() {
    if (!alive || !reducedMotion()) return;
    // Stop in-flight animation immediately if the OS preference changes.
    cancelTimers();
    dialogue.textContent = currentText;
    updatePortrait();
    root.dataset.characterMotion = "false";
    root.dataset.phase = "static";
  }

  function setCharacterMotion(payload) {
    if (typeof payload?.enabled !== "boolean" || !Number.isSafeInteger(payload.revision) || payload.revision <= preferenceRevision) return;
    preferenceRevision = payload.revision;
    characterMotion = payload.enabled;
    root.dataset.characterMotion = String(characterMotion && !reducedMotion());
    clearTimeout(blinkTimer);
    clearTimeout(blinkEndTimer);
    clearInterval(speechTimer);
    blinkTimer = undefined;
    blinkEndTimer = undefined;
    speechTimer = undefined;
    blinking = false;
    opening = "closed";
    updatePortrait();
    if (characterMotion) scheduleBlink();
  }

  return { render, speech, extend, clear, preferencesChanged, setCharacterMotion, refreshPortrait: () => { if (alive) updatePortrait(); }, dispose: () => clear() };
}
