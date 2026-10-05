// End-to-end: generate a fixture data dir, start the server, call every endpoint.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { CONFIG_PY, MAIN_PY, tarOf } from './helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgc-dash-'));
let server;
let base;
let fakeDocker;

const AUTH = `Basic ${Buffer.from('admin:pw').toString('base64')}`;

function get(p, headers = { Authorization: AUTH }) {
  return fetch(base + p, { headers }).then(async (r) => ({ status: r.status, headers: r.headers, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }));
}

before(async () => {
  execFileSync(process.execPath, ['scripts/make-fixture.js', dir], { stdio: 'ignore' });

  // Minimal fake Docker API (what docker-socket-proxy would forward).
  const started = new Date(Date.now() - 3 * 3600_000).toISOString();
  fakeDocker = http.createServer((req, res) => {
    if (req.url.startsWith('/containers/fgc-remaster/json')) {
      res.end(JSON.stringify({
        Id: 'abcdef1234567890', Name: '/fgc-remaster',
        Config: { Image: 'ghcr.io/p-adamiec/free-games-claimer-remaster:latest', Labels: { 'org.opencontainers.image.version': 'v1.11' }, Env: ['STORES=epic,gog,hb', 'SCHEDULER_HOURS=6', 'EG_PASSWORD=topsecret', 'COMMIT=0123456789'] },
        State: { Status: 'running', Running: true, StartedAt: started, Health: { Status: 'healthy' } },
        RestartCount: 0,
      }));
    } else if (req.url.startsWith('/containers/fgc-remaster/archive')) {
      const file = new URL(req.url, 'http://x').searchParams.get('path');
      const files = { '/fgc/main.py': MAIN_PY, '/fgc/src/core/config.py': CONFIG_PY };
      if (files[file]) res.end(tarOf(path.basename(file), files[file]));
      else { res.statusCode = 404; res.end('{"message":"no such file"}'); }
    } else if (req.url.startsWith('/containers/fgc-remaster/logs')) {
      const t = (min) => new Date(Date.parse(started) + min * 60_000).toISOString();
      res.end(`${t(0.1)} INFO 🎮 Starting claiming run… epic, gog\n${t(4)} INFO ✔ Claiming run complete.\n`);
    } else {
      res.statusCode = 404;
      res.end('{"message":"no such container"}');
    }
  });
  await new Promise((r) => fakeDocker.listen(0, '127.0.0.1', r));

  const cfg = loadConfig({
    FGC_DATA_DIR: dir,
    FGC_ENV_FILE: path.join(dir, 'nope.env'),
    BASIC_AUTH_USER: 'admin',
    BASIC_AUTH_PASS: 'pw',
    DOCKER_HOST: `tcp://127.0.0.1:${fakeDocker.address().port}`,
  });
  server = createServer(cfg);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fakeDocker?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('basic auth protects everything but /api/health', async () => {
  assert.equal((await get('/api/status', {})).status, 401);
  assert.equal((await get('/', {})).status, 401);
  assert.equal((await get('/api/health', {})).status, 200);
  assert.equal((await get('/api/status')).status, 200);
});

test('status and schedule use the container', async () => {
  const { body: st } = await get('/api/status');
  assert.equal(st.docker, 'enabled');
  assert.equal(st.container.health, 'healthy');
  assert.equal(st.container.commit, '0123456');
  assert.equal(st.run.inProgress, false);
  assert.equal(st.run.last.durationSec, 234);
  const { body: sc } = await get('/api/schedule');
  assert.equal(sc.source, 'container');
  assert.equal(sc.intervalHours, 6);
  assert.equal(sc.nextRunSource, 'exact');
  assert.ok(Date.parse(sc.nextRun) > Date.now());
});

test('services reflect container env and never leak secrets', async () => {
  const { body } = await get('/api/services');
  assert.ok(!JSON.stringify(body).includes('topsecret'));
  const byId = Object.fromEntries(body.services.map((s) => [s.id, s]));
  assert.equal(byId.epic.enabled, true);
  assert.equal(byId.steam.enabled, false);
  assert.equal(byId.epic.counts.claimed, 5);
  assert.equal(byId.epic.profileExists, true);
  // Store list comes from the claimer's main.py: the made-up "humble" store appears,
  // gog (absent from that main.py) still shows, because the DB has games for it.
  assert.equal(body.catalogSource, 'claimer v1.11');
  assert.equal(body.catalogError, null);
  assert.equal(byId.humble.enabled, true);
  assert.equal(byId.humble.discovered, true);
  assert.equal(byId.gog.label, 'GOG');
  assert.equal(byId.gog.note, 'Not in your claimer version');
  assert.equal(byId.gog.counts.claimed, 1);
  assert.equal(byId.microsoft.enabled, false);
});

test('games filter, mask and hide codes', async () => {
  const { body } = await get('/api/games?store=prime&pageSize=10');
  assert.equal(body.total, 3);
  assert.ok(body.rows.every((r) => r.user === 'p***@gmail.com'));
  assert.ok(body.rows.every((r) => r.code === null));
  assert.ok(body.rows.some((r) => r.hasCode && r.externalStore === 'GOG'));
  const failed = await get('/api/games?group=failed');
  assert.equal(failed.body.total, 1);
  const search = await get('/api/games?q=hogwarts');
  assert.equal(search.body.rows[0].title, 'Hogwarts Legacy');
});

test('stats and overview', async () => {
  const { body } = await get('/api/overview');
  assert.equal(body.stats.months.length, 12);
  assert.ok(body.stats.claimedTotal >= 10);
});

test('screenshots are listed and path traversal is blocked', async () => {
  const { body } = await get('/api/screenshots');
  assert.equal(body.screenshots.length, 2);
  const ok = await get(`/api/screenshots/${body.screenshots[0].path}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal((await get('/api/screenshots/..%2Ffgc.db')).status, 404);
  assert.equal((await get('/api/screenshots/..%2F..%2F..%2Fetc%2Fpasswd')).status, 404);
  // fetch() normalises plain "../" away; the SPA fallback must never expose the file.
  assert.doesNotMatch((await get('/api/screenshots/../../etc/passwd')).body, /root:/);
});

test('static UI is served with security headers', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.body, /FGC Dashboard/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await get('/../src/config.js')).body.includes('loadConfig'), false);
});
