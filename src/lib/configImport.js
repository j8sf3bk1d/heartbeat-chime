import { extractImportableState } from "./configState.js";

// A config file is portable; operating-system login registration and the
// current scheduler intent belong to this installation, not the source machine.
export function prepareConfigImport(payload, { state, createDefaultState, normalizeState, presets, profileIds }) {
  const input = extractImportableState(payload);
  if (!input || Array.isArray(input)) throw new Error("Invalid config file");
  const candidate = normalizeState(input, createDefaultState(), presets, profileIds, { explicitImport: true });
  candidate.launchAtLogin = state.launchAtLogin;
  candidate.schedulerRequested = state.schedulerRequested;
  return candidate;
}

// Persist before touching the scheduler or live state, so a rejected write
// leaves the running configuration intact. No OS startup operation occurs here.
export function commitConfigImport(candidate, { state, saveState, stopScheduler, shouldStop }) {
  if (!saveState(candidate)) throw new Error("Could not save the imported configuration. Check storage and try again.");
  Object.assign(state, candidate);
  if (shouldStop) stopScheduler({ preserveRequest: true });
}
