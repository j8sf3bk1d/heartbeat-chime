export function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function formatDateTime(epochMs) {
  return new Date(epochMs).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

// Keep the original unreadable record until a separate recovery copy and its
// pointer are safely stored. A full or unavailable store must never turn a
// read failure into a destructive write of defaults.
export function createStatePersistence({ storageKey, getStorage = () => window.localStorage, onStatus = () => {} }) {
  const pointerKey = `${storageKey}-recovery-latest`;
  let blocked = false;
  let recovery = null;
  let storage;

  function notify(message, canDismiss = false) {
    onStatus({ message, recovery, canDismiss: canDismiss && !blocked });
  }

  function load({ createDefaultState, soundProfiles, normalizeState, presets }) {
    const defaults = createDefaultState();
    try {
      storage = getStorage();
      const priorKey = storage.getItem(pointerKey);
      if (priorKey) {
        const priorRaw = storage.getItem(priorKey);
        if (priorRaw !== null) recovery = { key: priorKey, raw: priorRaw };
      }
      const raw = storage.getItem(storageKey);
      if (raw === null) {
        if (recovery) notify("An unreadable configuration was preserved. Download it for recovery or dismiss this notice.", true);
        return defaults;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid configuration shape");
        const result = normalizeState(parsed, defaults, presets, soundProfiles.map((profile) => profile.id), { migrate: true });
        if (recovery) notify("An unreadable configuration was preserved. Download it for recovery or dismiss this notice.", true);
        return result;
      } catch (error) {
        let key = `${storageKey}-recovery-${Date.now()}`;
        let suffix = 0;
        while (storage.getItem(key) !== null) key = `${storageKey}-recovery-${Date.now()}-${++suffix}`;
        recovery = { key, raw };
        try {
          storage.setItem(key, raw);
          storage.setItem(pointerKey, key);
          notify("Heartbeat could not read its saved configuration. A recovery copy was preserved; download it before dismissing this notice.", true);
        } catch {
          blocked = true;
          notify("Heartbeat could not read or safely copy its saved configuration. Settings cannot be saved; download the original and free storage space before restarting.");
        }
        return defaults;
      }
    } catch {
      blocked = true;
      notify("Heartbeat cannot access local storage. Settings will not be saved; check storage permissions and restart.");
      return defaults;
    }
  }

  function save(value) {
    if (blocked) return false;
    try {
      storage.setItem(storageKey, JSON.stringify(value));
      return true;
    } catch {
      notify("Heartbeat could not save settings. Check storage permissions or available space; changes may be lost when the app closes.");
      return false;
    }
  }

  function dismissRecovery() {
    try {
      storage.removeItem(pointerKey);
      recovery = null;
      return true;
    } catch {
      notify("Heartbeat could not update its recovery notice. Check storage permissions.");
      return false;
    }
  }

  return { load, save, dismissRecovery };
}

export function makeExportFilename() {
  const now = new Date();
  const two = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(
    now.getMinutes()
  )}${two(now.getSeconds())}`;
  return `heartbeat-config-${stamp}.json`;
}

export function downloadJsonFile({ filename, data }) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function extractImportableState(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (payload.state && typeof payload.state === "object") {
    return payload.state;
  }
  return payload;
}
