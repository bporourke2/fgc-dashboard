import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enabledStores, envArrayToObject, parseDotenv, parseFixedTimes, summarize } from '../src/fgcConfig.js';
import { DEFAULT_STORES } from '../src/stores.js';

test('parseDotenv handles quotes, comments and export', () => {
  const env = parseDotenv(`
# comment
export STORES=epic, gog
EG_PASSWORD="p#ss word"
PG_PASSWORD='single'
SCHEDULER_HOURS=6 # inline comment
EMPTY=
`);
  assert.equal(env.STORES, 'epic, gog');
  assert.equal(env.EG_PASSWORD, 'p#ss word');
  assert.equal(env.PG_PASSWORD, 'single');
  assert.equal(env.SCHEDULER_HOURS, '6');
  assert.equal(env.EMPTY, '');
});

test('envArrayToObject keeps "=" inside values', () => {
  assert.deepEqual(envArrayToObject(['A=1', 'NOTIFY=tgram://x?a=b', 'BAD']), { A: '1', NOTIFY: 'tgram://x?a=b' });
});

test('STORES defaults, aliases and unknown names', () => {
  assert.deepEqual([...enabledStores({}).enabled], DEFAULT_STORES);
  assert.ok(enabledStores({}).enabled.has('microsoft'));
  assert.ok(!enabledStores({}).enabled.has('fab'), 'Fab is opt-in since FGC-R 1.11');
  const r = enabledStores({ STORES: 'Epic-Games, amazon,ae,itch,xbox,gamerpower,bogus' });
  assert.deepEqual([...r.enabled].sort(), ['aliexpress', 'epic', 'itchio', 'microsoft', 'prime']);
  assert.deepEqual(r.unknown, ['bogus'], 'gamerpower is a source, not an unknown store');
  // *_ENABLE switches were removed in FGC-R 1.11.
  assert.ok(!enabledStores({ FANATICAL_ENABLE: 'true' }).enabled.has('fanatical'));
});

test('parseFixedTimes validates and sorts', () => {
  assert.deepEqual(parseFixedTimes('20:00, 8:30,25:00,bad'), [{ hour: 8, minute: 30 }, { hour: 20, minute: 0 }]);
});

test('summarize exposes only booleans for secrets', () => {
  const s = summarize({ EMAIL: 'me@x.com', PASSWORD: 'hunter2', EG_OTP_KEY: 'K', NOTIFY: 'discord://a/b', SCHEDULER_HOURS: '0' }, 'test');
  const json = JSON.stringify(s);
  assert.ok(!json.includes('hunter2'));
  assert.ok(!json.includes('me@x.com'));
  assert.ok(!json.includes('discord://'));
  const epic = s.stores.find((x) => x.id === 'epic');
  assert.equal(epic.credentialsConfigured, true);
  assert.equal(epic.otpConfigured, true);
  const steam = s.stores.find((x) => x.id === 'steam');
  assert.equal(steam.credentialsConfigured, false);
  assert.equal(s.schedule.intervalHours, 0);
  assert.equal(s.schedule.runOnStartup, true);
  assert.equal(s.schedule.runOnce, false);
  assert.equal(summarize({ RUN_ONCE: 'true' }, 'test').schedule.runOnce, true);
  const steam2 = summarize({ STEAM_USERNAME: 'u', PASSWORD: 'p' }, 'test').stores.find((x) => x.id === 'steam');
  assert.equal(steam2.credentialsConfigured, true, 'Steam password falls back to PASSWORD');
  assert.equal(s.notify.apprise, true);
});
