import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskAccount, normalizeTimestamp, statusGroup } from '../src/db.js';
import { demuxLogs, parseDockerHost, parseRuns, summarizeRuns } from '../src/docker.js';

test('statusGroup maps FGC-R statuses', () => {
  const cases = {
    claimed: 'claimed',
    'claimed and redeemed': 'claimed',
    existed: 'owned',
    'already redeemed': 'owned',
    unknown: 'pending',
    failed: 'failed',
    'failed:missing_base': 'failed',
    'Giveaway button not found': 'info',
    'Could not claim': 'failed',
    free_to_play: 'info',
    not_steam: 'info',
    notified: 'info',
  };
  for (const [s, g] of Object.entries(cases)) assert.equal(statusGroup(s), g, s);
});

test('normalizeTimestamp treats naive values as UTC', () => {
  assert.equal(normalizeTimestamp('2026-10-01 12:34:56'), '2026-10-01T12:34:56.000Z');
  assert.equal(normalizeTimestamp('2026-10-01 12:34:56.123456'), '2026-10-01T12:34:56.123Z');
  assert.equal(normalizeTimestamp('2026-10-01T12:34:56+02:00'), '2026-10-01T10:34:56.000Z');
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp('garbage'), null);
});

test('maskAccount masks emails only', () => {
  assert.equal(maskAccount('peter@gmail.com'), 'p***@gmail.com');
  assert.equal(maskAccount('GamerDude'), 'GamerDude');
});

test('parseDockerHost', () => {
  assert.deepEqual(parseDockerHost('unix:///var/run/docker.sock'), { socketPath: '/var/run/docker.sock' });
  assert.deepEqual(parseDockerHost('tcp://socket-proxy:2375'), { host: 'socket-proxy', port: 2375 });
  assert.equal(parseDockerHost(''), null);
});

test('demuxLogs handles multiplexed and tty streams', () => {
  const frame = (s) => {
    const b = Buffer.from(s);
    const h = Buffer.alloc(8);
    h[0] = 1;
    h.writeUInt32BE(b.length, 4);
    return Buffer.concat([h, b]);
  };
  assert.equal(demuxLogs(Buffer.concat([frame('a\n'), frame('b\n')])), 'a\nb\n');
  assert.equal(demuxLogs(Buffer.from('plain\n')), 'plain\n');
});

test('parseRuns finds start/end pairs and strips ANSI', () => {
  const log = [
    '2026-10-03T08:00:03.1Z \x1b[2m[10:00:03]\x1b[0m INFO     Scheduler active - runs every 12 hours; no fixed times.   main.py:200',
    '2026-10-03T08:00:04.0Z [10:00:04] INFO     🎮 Starting claiming run… steam, epic, gog   claimer.py:51',
    '2026-10-03T08:05:10.0Z [10:05:10] INFO     ✔ Claiming run complete.   claimer.py:90',
    '2026-10-03T20:00:04.0Z [22:00:04] INFO     🎮 Starting claiming run… steam   claimer.py:51',
  ].join('\n');
  const runs = parseRuns(log);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].durationSec, 306);
  assert.equal(runs[0].stores, 'steam, epic, gog');
  const s = summarizeRuns(runs, Date.parse('2026-10-03T20:10:00Z'));
  assert.equal(s.inProgress, true);
  assert.equal(s.lastRun.start, '2026-10-03T08:00:04.000Z');
  const stale = summarizeRuns(runs, Date.parse('2026-10-04T08:00:00Z'));
  assert.equal(stale.inProgress, false);
  assert.equal(stale.history[0].aborted, true);
});
