export function computeNextAligned(nowMs, minutes) {
  const periodMs = minutes * 60 * 1000;
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    return nowMs;
  }
  return Math.ceil(nowMs / periodMs) * periodMs;
}

export function computeRecurringCatchUp(nowMs, nextAtMs, periodMs, { maxLatenessMs = 10_000 } = {}) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextAtMs) || !Number.isFinite(periodMs) || periodMs <= 0 || nowMs < nextAtMs) {
    return { fireCount: 0, nextAtMs, dueAtMs: null, skippedCount: 0 };
  }
  // Discard the backlog in one calculation. Only the latest boundary can still
  // be useful, and only briefly after its scheduled time.
  const dueCount = Math.floor((nowMs - nextAtMs) / periodMs) + 1;
  const latestDueAtMs = nextAtMs + (dueCount - 1) * periodMs;
  const graceMs = Number.isFinite(maxLatenessMs) ? Math.max(0, maxLatenessMs) : 10_000;
  const fireCount = nowMs - latestDueAtMs <= graceMs ? 1 : 0;
  return {
    fireCount,
    nextAtMs: latestDueAtMs + periodMs,
    dueAtMs: fireCount ? latestDueAtMs : null,
    skippedCount: dueCount - fireCount
  };
}

export function selectRecurringEntries(dueEntries, suppressLowerIntervalsOnCollision = true) {
  if (!Array.isArray(dueEntries) || dueEntries.length === 0) {
    return { selected: [], suppressed: [] };
  }
  if (!suppressLowerIntervalsOnCollision || dueEntries.length === 1) {
    return {
      selected: dueEntries,
      suppressed: []
    };
  }

  const highestByTimestamp = new Map();
  for (const entry of dueEntries) {
    if (Number.isFinite(entry.scheduledAtMs)) {
      highestByTimestamp.set(entry.scheduledAtMs, Math.max(highestByTimestamp.get(entry.scheduledAtMs) || 0, entry.minutes));
    }
  }
  const collidesWithHigher = (entry) => Number.isFinite(entry.scheduledAtMs) && entry.minutes < highestByTimestamp.get(entry.scheduledAtMs);
  const selected = dueEntries.filter((entry) => !collidesWithHigher(entry));
  const suppressed = dueEntries.filter(collidesWithHigher);

  return {
    selected,
    suppressed
  };
}
