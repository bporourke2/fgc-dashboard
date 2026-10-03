import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSchedule, nextFixedRuns, nextIntervalRuns, SCHEDULER_START_DELAY_MS, zonedToUtc } from '../src/schedule.js';

const H = 3600_000;
const sched = (o) => ({ intervalHours: 12, fixedTimes: [], timezone: 'UTC', runOnStartup: true, ...o });

test('zonedToUtc handles summer and winter offsets', () => {
  assert.equal(new Date(zonedToUtc(2026, 7, 1, 8, 0, 'Europe/Warsaw')).toISOString(), '2026-07-01T06:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 12, 1, 8, 0, 'Europe/Warsaw')).toISOString(), '2026-12-01T07:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 3, 1, 8, 0, 'America/New_York')).toISOString(), '2026-03-01T13:00:00.000Z');
});

test('fixed times across the DST change (Europe/Warsaw, 25 Oct 2026)', () => {
  const now = Date.parse('2026-10-24T12:00:00Z'); // 14:00 CEST
  const runs = nextFixedRuns(now, [{ hour: 8, minute: 0 }, { hour: 20, minute: 0 }], 'Europe/Warsaw', 4).map((t) => new Date(t).toISOString());
  assert.deepEqual(runs, [
    '2026-10-24T18:00:00.000Z', // 20:00 CEST
    '2026-10-25T07:00:00.000Z', // 08:00 CET (after fall back)
    '2026-10-25T19:00:00.000Z',
    '2026-10-26T07:00:00.000Z',
  ]);
});

test('interval runs anchor on start', () => {
  const anchor = Date.parse('2026-10-01T00:00:00Z');
  const now = anchor + 25 * H;
  assert.deepEqual(nextIntervalRuns(now, anchor, 12, 2), [anchor + 36 * H, anchor + 48 * H]);
  assert.deepEqual(nextIntervalRuns(anchor + 1000, anchor, 12, 1), [anchor + 12 * H]);
  assert.deepEqual(nextIntervalRuns(now, anchor, 0), []);
});

test('computeSchedule: interval from container start is exact', () => {
  const startedAt = Date.parse('2026-10-01T00:00:00Z');
  const r = computeSchedule(sched(), { now: startedAt + 5 * H, startedAt });
  assert.equal(r.mode, 'interval');
  assert.equal(r.nextRunSource, 'exact');
  assert.equal(r.nextRun, new Date(startedAt + SCHEDULER_START_DELAY_MS + 12 * H).toISOString());
});

test('computeSchedule: without docker the interval is estimated, or unknown', () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const est = computeSchedule(sched(), { now, lastActivity: now - 2 * H });
  assert.equal(est.nextRunSource, 'estimated');
  assert.equal(est.nextRun, new Date(now + 10 * H).toISOString());
  const unknown = computeSchedule(sched(), { now });
  assert.equal(unknown.nextRun, null);
  assert.equal(unknown.unknownReason, 'no-anchor');
});

test('computeSchedule: earliest of interval and fixed; partial without anchor', () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  const s = sched({ fixedTimes: [{ hour: 11, minute: 0 }] });
  const both = computeSchedule(s, { now, startedAt: now - 1 * H });
  assert.equal(both.mode, 'interval+fixed');
  assert.equal(both.nextRun, '2026-10-03T11:00:00.000Z');
  assert.equal(both.upcoming[1].kind, 'interval');
  const partial = computeSchedule(s, { now });
  assert.equal(partial.nextRunSource, 'partial');
  // Fixed run is next but the interval is only estimated → still partial, not exact.
  const est = computeSchedule(s, { now, lastActivity: now - 1 * H });
  assert.equal(est.nextRun, '2026-10-03T11:00:00.000Z');
  assert.equal(est.nextRunSource, 'partial');
  const fixedOnly = computeSchedule(sched({ intervalHours: 0, fixedTimes: [{ hour: 9, minute: 0 }] }), { now });
  assert.equal(fixedOnly.nextRun, '2026-10-04T09:00:00.000Z');
  assert.equal(fixedOnly.nextRunSource, 'exact');
});

test('computeSchedule: invalid timezone falls back to UTC', () => {
  const r = computeSchedule(sched({ intervalHours: 0, fixedTimes: [{ hour: 9, minute: 0 }], timezone: 'Mars/Base' }), { now: Date.parse('2026-10-03T08:00:00Z') });
  assert.equal(r.timezoneValid, false);
  assert.equal(r.nextRun, '2026-10-03T09:00:00.000Z');
});

test('computeSchedule: manual mode', () => {
  const r = computeSchedule(sched({ intervalHours: 0 }), { now: Date.now() });
  assert.equal(r.mode, 'manual');
  assert.equal(r.nextRun, null);
  assert.equal(r.unknownReason, null);
});
