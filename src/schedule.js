// Next-run computation mirroring FGC-R's APScheduler setup in main.py:
//   IntervalTrigger(hours=SCHEDULER_HOURS) anchored at scheduler start (≈ container start),
//   plus one CronTrigger(hour, minute, timezone=SCHEDULER_TIMEZONE) per SCHEDULER_FIXED_TIMES entry.

const HOUR = 3600_000;
// main.py starts the scheduler a few seconds after process start.
export const SCHEDULER_START_DELAY_MS = 3000;

const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz) {
  try { dtf(tz); return true; } catch { return false; }
}

/** Wall-clock parts of an instant in a time zone. */
function partsIn(ms, tz) {
  const p = {};
  for (const { type, value } of dtf(tz).formatToParts(new Date(ms))) p[type] = Number(value);
  return p;
}

/** Offset (ms) of tz from UTC at the given instant. */
function offsetAt(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Convert a wall-clock time in tz to a UTC instant (handles DST transitions). */
export function zonedToUtc(year, month, day, hour, minute, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(ms, tz);
  if (second !== ms) ms = second;
  return ms;
}

/** Next fixed-time occurrences strictly after `now`, ascending. */
export function nextFixedRuns(now, times, tz, count = 5) {
  if (!times.length) return [];
  const today = partsIn(now, tz);
  const out = [];
  for (let d = 0; out.length < count && d < count + 2; d++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
    for (const t of times) {
      const ms = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), t.hour, t.minute, tz);
      if (ms > now) out.push(ms);
    }
  }
  return out.sort((a, b) => a - b).slice(0, count);
}

/** Next interval occurrences after `now`, anchored at `anchor`. */
export function nextIntervalRuns(now, anchor, hours, count = 5) {
  if (!(hours > 0) || !Number.isFinite(anchor)) return [];
  const step = hours * HOUR;
  const k = Math.max(1, Math.floor((now - anchor) / step) + 1);
  return Array.from({ length: count }, (_, i) => anchor + (k + i) * step);
}

/**
 * A fixed-time run is only certainly next if the interval timing is exact too;
 * otherwise an (estimated or unknown) interval run might come earlier → 'partial'.
 */
function nextSource(next, intervalSource) {
  if (next.kind === 'interval') return next.source;
  return intervalSource === 'exact' ? 'exact' : 'partial';
}

/**
 * @param {object} sched  summarize().schedule
 * @param {object} ctx    { now, startedAt?: ms (container start, exact), lastActivity?: ms (estimate) }
 */
export function computeSchedule(sched, { now = Date.now(), startedAt = null, lastActivity = null } = {}) {
  let tz = sched.timezone;
  const tzValid = isValidTimezone(tz);
  if (!tzValid) tz = 'UTC';

  let anchor = null;
  let intervalSource = null;
  if (sched.intervalHours > 0) {
    if (startedAt) {
      anchor = startedAt + SCHEDULER_START_DELAY_MS;
      intervalSource = 'exact';
    } else if (lastActivity) {
      anchor = lastActivity;
      intervalSource = 'estimated';
    }
  }

  const runs = [
    ...nextIntervalRuns(now, anchor, sched.intervalHours).map((t) => ({ at: t, kind: 'interval', source: intervalSource })),
    ...nextFixedRuns(now, sched.fixedTimes, tz).map((t) => ({ at: t, kind: 'fixed', source: 'exact' })),
  ].sort((a, b) => a.at - b.at);

  // Collapse runs within a minute of each other (the claim lock makes the second a no-op).
  const upcoming = [];
  for (const r of runs) {
    if (upcoming.length && r.at - upcoming[upcoming.length - 1].at < 60_000) continue;
    upcoming.push(r);
    if (upcoming.length === 5) break;
  }

  let mode = 'manual';
  if (sched.intervalHours > 0 && sched.fixedTimes.length) mode = 'interval+fixed';
  else if (sched.intervalHours > 0) mode = 'interval';
  else if (sched.fixedTimes.length) mode = 'fixed';

  const next = upcoming[0] ?? null;
  return {
    mode,
    intervalHours: sched.intervalHours,
    fixedTimes: sched.fixedTimes.map((t) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`),
    timezone: tz,
    timezoneValid: tzValid,
    runOnStartup: sched.runOnStartup,
    nextRun: next ? new Date(next.at).toISOString() : null,
    nextRunSource: next ? nextSource(next, sched.intervalHours > 0 ? intervalSource : 'exact') : null,
    // Interval mode without Docker and without any DB activity cannot be predicted at all.
    unknownReason: !next && mode.startsWith('interval') ? 'no-anchor' : null,
    upcoming: upcoming.map((r) => ({ at: new Date(r.at).toISOString(), kind: r.kind, source: r.source })),
  };
}
