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

test('STORES defaults, aliases, unknown names and legacy flags', () => {
  assert.deepEqual([...enabledStores({}).enabled], DEFAULT_STORES);
  const r = enabledStores({ STORES: 'Epic-Games, amazon,ae,itch,bogus' });
  assert.deepEqual([...r.enabled].sort(), ['aliexpress', 'epic', 'itchio', 'prime']);
  assert.deepEqual(r.unknown, ['bogus']);
  const legacy = enabledStores({ FANATICAL_ENABLE: 'true' });
  assert.ok(legacy.enabled.has('fanatical'));
  assert.ok(legacy.enabled.has('epic'));
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
  assert.equal(s.notify.apprise, true);
});
