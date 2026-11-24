export const COMPANION_NAME_LIMIT = 40;
export function normalizeCompanionName(value) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').trim().slice(0, COMPANION_NAME_LIMIT) : '';
}
export function companionDisplayName(settings, packName) {
  const custom = settings?.companionNameMode === 'custom' ? normalizeCompanionName(settings.companionCustomName) : '';
  return custom || packName || 'Heartbeat';
}
export function readCompanionDisplayName(packName, storage) {
  try { return companionDisplayName(JSON.parse((storage || globalThis.localStorage).getItem('heartbeat-state-v1') || '{}'), packName); }
  catch { return packName || 'Heartbeat'; }
}
