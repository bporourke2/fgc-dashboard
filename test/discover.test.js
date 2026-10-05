import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCatalog, firstFileFromTar, parseConfigPy, parseMainPy } from '../src/discover.js';
import { enabledStores, summarize } from '../src/fgcConfig.js';
import { CONFIG_PY, MAIN_PY, tarOf } from './helpers.js';

test('parseMainPy reads the store registry', () => {
  const m = parseMainPy(MAIN_PY);
  assert.deepEqual(m.claimers.map((c) => c.id), ['steam', 'epic', 'fab', 'microsoft', 'humble']);
  assert.equal(m.claimers[4].label, 'Humble Bundle');
  assert.deepEqual(m.sides, ['itchio', 'fanatical']);
  assert.deepEqual(m.defaults, ['steam', 'epic', 'microsoft', 'humble']);
  assert.equal(m.aliases.hb, 'humble');
  assert.equal(parseMainPy('print("not fgc")'), null);
});

test('parseConfigPy maps credential prefixes to stores', () => {
  const m = parseMainPy(MAIN_PY);
  const c = parseConfigPy(CONFIG_PY, m.aliases);
  assert.deepEqual(c.microsoft, { user: ['MS_EMAIL', 'EMAIL'], pass: ['MS_PASSWORD', 'PASSWORD'], otp: ['MS_OTP_KEY'] });
  assert.deepEqual(c.epic.otp, ['EG_OTP_KEY', 'EG_OTPKEY']);
  assert.deepEqual(c.humble.user, ['HB_EMAIL', 'EMAIL'], 'prefix resolved through the alias table');
  assert.deepEqual(c.steam.user, ['STEAM_USERNAME']);
});

test('buildCatalog: new stores appear, defaults decide opt-in, built-in labels win', () => {
  const m = parseMainPy(MAIN_PY);
  const cat = buildCatalog(m, parseConfigPy(CONFIG_PY, m.aliases), 'v9.9');
  assert.equal(cat.source, 'claimer v9.9');
  const by = Object.fromEntries(cat.stores.map((s) => [s.id, s]));
  assert.equal(by.humble.label, 'Humble Bundle');
  assert.equal(by.humble.discovered, true);
  assert.equal(by.humble.optIn, false);
  assert.equal(by.fab.optIn, true);
  assert.equal(by.fab.note, 'Uses the Epic account');
  assert.equal(by.microsoft.label, 'Microsoft Store');
  assert.equal(by.itchio.optIn, true);
  assert.ok(!cat.stores.some((s) => s.id === 'gog'), 'only stores the claimer has');

  assert.deepEqual([...enabledStores({}, cat).enabled], ['steam', 'epic', 'microsoft', 'humble']);
  assert.ok(enabledStores({ STORES: 'hb,itch' }, cat).enabled.has('humble'));
  const s = summarize({ HB_EMAIL: 'x', PASSWORD: 'y' }, 'test', cat);
  assert.equal(s.stores.find((x) => x.id === 'humble').credentialsConfigured, true);
  assert.equal(s.catalogSource, 'claimer v9.9');
});

test('firstFileFromTar extracts the file', () => {
  assert.equal(firstFileFromTar(tarOf('main.py', MAIN_PY)), MAIN_PY);
  assert.equal(firstFileFromTar(Buffer.alloc(1024)), null);
});
