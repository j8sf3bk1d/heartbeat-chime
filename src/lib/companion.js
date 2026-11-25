import { getBuiltInVoiceMetadata } from "./builtInVoices.js";
import { PRESETS } from "./soundProfiles.js";
import { isCompanionExpression } from "./companionExpressions.js";
import { resolveCuePresetId } from "./presetPlayback.js";
import { selectedCharacter } from "./characterStore.js";

// Preview rotation is session-only and independent of scheduled chimes. Treat
// alternate takes of one line as repeats so consecutive demos sound distinct.
export function createCompanionPreviewPicker({ presetIds, getRepeatGroup, random = Math.random }) {
  let previous = null;
  return () => {
    const selected = resolveCuePresetId({ presetIds, playbackMode: "random" }, { random, excludePresetId: previous, getRepeatGroup });
    if (selected) previous = selected;
    return selected;
  };
}

export function expressionForDirection(direction = "") {
  const text = String(direction).toLowerCase();
  if (/shy|flustered/.test(text)) return "flustered";
  if (/smug|haughty|mischiev|teas|dry|impatient/.test(text)) return "smug";
  return "neutral";
}

export function expressionForVoice(voice) {
  if (voice?.expression === undefined) return expressionForDirection(voice?.direction);
  return isCompanionExpression(voice.expression) ? voice.expression : "neutral";
}

export function companionCueForPreset(presetId, getPresetLabel) {
  const voice = getBuiltInVoiceMetadata(presetId);
  const text = voice?.text || getPresetLabel(presetId) || "Chime";
  return {
    text: String(text).slice(0, 500),
    // Curated expression is the source of truth; fall back only for legacy
    // clips that predate explicit metadata. Unknown values remain harmless.
    expression: expressionForVoice(voice),
    // Keep the line readable briefly after playback is scheduled.
    durationMs: Math.min(12000, Math.max(4000, Math.ceil((Number(voice?.durationSeconds) || 3) * 1000 + 2000)))
  };
}

// Imported clips have no reliable inferred type. Preserve their existing behavior
// unless the pack explicitly identifies them as effects.
export function isNonVoicePreset(presetId, getPreset = () => null) {
  if (getBuiltInVoiceMetadata(presetId)) return false;
  if (PRESETS.some((preset) => preset.id === presetId)) return true;
  const tags = getPreset(presetId)?.tags;
  if (!Array.isArray(tags)) return false;
  const normalized = tags.map((tag) => String(tag).trim().toLowerCase());
  if (normalized.some((tag) => tag === "voice" || tag === "spoken")) return false;
  return normalized.some((tag) => tag === "sound effect" || tag === "sfx");
}

// Warming never shows a window. Keep this optional for browser/disabled mode,
// and do not report a stale error if the companion was disabled in flight.
export async function prewarmCompanionIfEnabled({ state, isDesktopRuntime, prewarm, onError = () => {} }) {
  if (!state.companionEnabled || !isDesktopRuntime()) return false;
  try {
    const ready = await prewarm();
    if (!ready) throw new Error("Companion preparation failed.");
    return true;
  } catch (error) {
    if (state.companionEnabled) onError(error);
    return false;
  }
}

export function createCompanionController({ state, isDesktopRuntime, show, hide, sendSpeech = () => {}, sendTiming = () => {}, setMotionPreference = () => {}, shouldAnimateSpeech = () => !globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches, getPresetLabel, getPreset = () => null, onCue = () => {}, onError = () => {}, leadMs = 1000, showTimeoutMs = 2200 }) {
  // A timestamp-based starting point also advances across ordinary WebView
  // reloads while the native window and its latest generation stay alive.
  let generation = Date.now() * 1024;
  let motionRevision = Date.now() * 1024;
  const pending = new Set();
  let visualBusyUntil = 0;
  let playbackEpoch = 0;
  function cancelableWait(ms, cancellation) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ kind: "timeout" }), ms); });
    return (cancellation ? Promise.race([timeout, cancellation]) : timeout).finally(() => clearTimeout(timer));
  }
  return {
    async playWithIntro({ presetId, play, prepare = () => true, targetAtMs, isCurrent = () => true, maxLatenessMs, lifecycle = () => {} }) {
      if (!state.companionEnabled || !isDesktopRuntime()) { lifecycle("play-request"); return play(undefined, undefined, { lifecycle }); }
      const epoch = playbackEpoch;
      const trace = { lifecycle };
      let cancellation;
      let current = null;
      const discardVisual = (result) => {
        if (current !== null && current === generation) {
          const newer = ++generation;
          void Promise.resolve().then(() => hide(newer)).catch(onError);
        }
        return result;
      };
      const playUnlessPaused = async (onBufferScheduled, onAudioTiming) => {
        if (epoch !== playbackEpoch || !isCurrent()) return discardVisual("cancelled");
        while (Number.isFinite(targetAtMs) && targetAtMs > Date.now()) {
          const waiting = await cancelableWait(targetAtMs - Date.now(), cancellation);
          if (waiting.kind === "cancel") return "cancelled";
          if (waiting.kind === "overlap") { await waiting.afterHide; cancellation = null; }
          if (waiting.kind === "fallback") cancellation = null;
        }
        if (epoch !== playbackEpoch || !isCurrent()) return discardVisual("cancelled");
        if (Number.isFinite(targetAtMs) && Number.isFinite(maxLatenessMs) && Date.now() - targetAtMs > maxLatenessMs) return discardVisual("stale");
        lifecycle("play-request");
        return play(onBufferScheduled, onAudioTiming, trace);
      };
      if (state.companionSuppressNonVoice === true && isNonVoicePreset(presetId, getPreset)) {
        // Preparation may run ahead, but playback must still wait for the cue's
        // target. Do not touch the visual generation for an overlapping voice.
        void Promise.resolve().then(prepare).catch(() => {});
        return await playUnlessPaused();
      }
      const cue = companionCueForPreset(presetId, getPresetLabel);
      const now = performance.now();
      if (pending.size || now < visualBusyUntil) {
        // One visual cannot accurately caption two overlapping voices. Hide it
        // and release every waiting chime to audio instead of dropping a cue or
        // displaying the wrong words. Cool down through the longest cue.
        const longest = Math.max(cue.durationMs, ...[...pending].map((token) => token.durationMs));
        visualBusyUntil = Math.max(visualBusyUntil, now + longest);
        const newer = ++generation;
        const hiding = Promise.resolve().then(() => hide(newer)).catch(onError);
        let timeout;
        const afterHide = Promise.race([hiding, new Promise((resolve) => { timeout = setTimeout(resolve, 500); })])
          .finally(() => clearTimeout(timeout));
        for (const token of pending) token.cancel({ kind: "overlap", afterHide });
        return afterHide.then(() => playUnlessPaused());
      }
      current = ++generation;
      let cancel;
      cancellation = new Promise((resolve) => { cancel = resolve; });
      const token = { cancel, durationMs: cue.durationMs };
      pending.add(token);
      try {
        // Avoid showing an utterance for a sound already known to be missing.
        // A slow preparation is bounded; normal audio still gets a chance.
        lifecycle("prepare-start");
        const preparationStarted = performance.now();
        const preparation = Promise.resolve().then(prepare)
          .then((ready) => ({ kind: ready ? "ready" : "unavailable" }), () => ({ kind: "unavailable" }));
        const prepareBudget = Number.isFinite(targetAtMs) ? Math.max(0, Math.min(showTimeoutMs, targetAtMs - Date.now())) : showTimeoutMs;
        const prepared = await Promise.race([preparation, cancelableWait(prepareBudget, cancellation)]);
        trace.prepareMs = performance.now() - preparationStarted;
        lifecycle("prepare-end", { result: prepared.kind });
        if (prepared.kind === "cancel") return "cancelled";
        if (prepared.kind === "overlap") await prepared.afterHide;
        if (prepared.kind !== "ready") return await playUnlessPaused();
        if (Number.isFinite(targetAtMs)) {
          let untilEntrance = targetAtMs - leadMs - Date.now();
          while (untilEntrance > 0) {
            const entranceWait = await cancelableWait(untilEntrance, cancellation);
            if (entranceWait.kind === "cancel") return "cancelled";
            if (entranceWait.kind === "overlap") { await entranceWait.afterHide; cancellation = null; return await playUnlessPaused(); }
            if (entranceWait.kind === "fallback") { cancellation = null; return await playUnlessPaused(); }
            untilEntrance = targetAtMs - leadMs - Date.now();
          }
          if (Number.isFinite(maxLatenessMs) && Date.now() - targetAtMs > maxLatenessMs) return "stale";
          // A missed entrance should not delay a cue by the full window timeout.
          if (Date.now() - targetAtMs > 250) return await playUnlessPaused();
        }
        // Show requests can wait for a cold WebView; bound this separately
        // from the entrance so a broken overlay cannot swallow a real chime.
        lifecycle("show-start");
        const showStarted = performance.now();
        if (!isCurrent()) return "cancelled";
        const characterId = selectedCharacter();
        try { onCue({presetId, cue, characterId, generation: current, targetAtMs}); } catch { /* Diagnostics must never interrupt playback. */ }
        const leadRemaining = Number.isFinite(targetAtMs) ? Math.max(0, Math.min(leadMs + 1000, targetAtMs - Date.now())) : leadMs;
        const showResult = Promise.resolve().then(() => show({ ...cue, characterId, characterMotion: state.companionCharacterMotion !== false, durationMs: cue.durationMs + leadRemaining, targetAtMs: Number.isFinite(targetAtMs) ? Math.round(targetAtMs) : undefined, monitorId: state.companionMonitorId, corner: state.companionCorner, size: state.companionSize ?? 100, generation: current }))
          .then((shown) => ({ kind: shown === true ? "shown" : "unavailable" }), (error) => { onError(error); return { kind: "unavailable" }; });
        const showBudget = Number.isFinite(targetAtMs) ? Math.max(0, Math.min(showTimeoutMs, targetAtMs - Date.now() + 100)) : showTimeoutMs;
        let outcome = await Promise.race([showResult, cancelableWait(showBudget, cancellation)]);
        trace.showMs = performance.now() - showStarted;
        lifecycle("show-end", { result: outcome.kind });
        if (outcome.kind === "timeout" && current === generation) {
          // Supersede a late native show so it cannot display mismatched text.
          const newer = ++generation;
          void Promise.resolve(hide(newer)).catch(onError);
        }
        const shown = outcome.kind === "shown";
        if (shown) {
          visualBusyUntil = performance.now() + cue.durationMs + leadRemaining;
          const introStarted = performance.now();
          outcome = await cancelableWait(Number.isFinite(targetAtMs) ? Math.max(0, targetAtMs - Date.now()) : leadMs, cancellation);
          trace.introMs = performance.now() - introStarted;
        }
        if (outcome.kind === "cancel") return "cancelled";
        if (outcome.kind === "overlap") await outcome.afterHide;
        const onBufferScheduled = shown && outcome.kind === "timeout" && state.companionCharacterMotion !== false && shouldAnimateSpeech() ? (speech) => {
          if (current !== generation || epoch !== playbackEpoch || !state.companionEnabled || state.companionCharacterMotion === false || !shouldAnimateSpeech()) return;
          // Speech motion is best-effort and must never affect cue playback.
          void Promise.resolve().then(() => sendSpeech({ ...speech, generation: current })).catch(onError);
        } : undefined;
        const onAudioTiming = shown && outcome.kind === "timeout" ? (timing) => {
          if (current !== generation || epoch !== playbackEpoch || !state.companionEnabled) return;
          if (!Number.isSafeInteger(timing?.startedAtMs) || !Number.isSafeInteger(timing?.durationMs) || timing.durationMs < 1 || timing.durationMs > 30000 || Math.abs(timing.startedAtMs - Date.now()) > 5000) return;
          visualBusyUntil = Math.max(visualBusyUntil, performance.now() + Math.max(0, timing.startedAtMs - Date.now()) + timing.durationMs + 2000);
          void Promise.resolve().then(() => {
            if (current === generation && epoch === playbackEpoch && state.companionEnabled) return sendTiming({ ...timing, generation: current });
          }).catch(onError);
        } : undefined;
        return await playUnlessPaused(onBufferScheduled, onAudioTiming);
      } finally { pending.delete(token); }
    },
    async setCharacterMotion(enabled) {
      const revision = ++motionRevision;
      try { await setMotionPreference(Boolean(enabled), revision); } catch (error) { onError(error); }
    },
    async dismiss({ cancelPlayback = true } = {}) {
      const current = ++generation;
      if (cancelPlayback) playbackEpoch += 1;
      for (const token of pending) token.cancel({ kind: cancelPlayback ? "cancel" : "fallback" });
      // Do not queue behind a cold-start show: hiding must cancel the native
      // readiness wait immediately. Native generation ordering rejects a late
      // older show even if this hide reaches it first.
      try { await hide(current); } catch (error) { onError(error); }
    }
  };
}
