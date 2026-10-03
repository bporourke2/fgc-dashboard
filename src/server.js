// HTTP server: JSON API + static UI. No external dependencies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { DashboardService } from './service.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'self'",
};

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function checkAuth(req, auth) {
  if (!auth) return true;
  const m = (req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const userOk = crypto.timingSafeEqual(sha(decoded.slice(0, i)), sha(auth.user));
  const passOk = crypto.timingSafeEqual(sha(decoded.slice(i + 1)), sha(auth.pass));
  return userOk && passOk;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function sendFile(res, file, cache = 'no-cache') {
  const ext = path.extname(file).toLowerCase();
  const stream = fs.createReadStream(file);
  stream.on('open', () => {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
    stream.pipe(res);
  });
  stream.on('error', () => sendJson(res, 404, { error: 'not found' }));
}

export function createServer(cfg = loadConfig()) {
  const svc = new DashboardService(cfg);

  const routes = {
    '/api/health': async () => ({ ok: true }),
    '/api/info': async () => ({
      version: VERSION,
      docker: svc.docker.enabled,
      container: cfg.container,
      showCodes: cfg.showCodes,
      maskAccounts: cfg.maskAccounts,
    }),
    '/api/status': () => svc.status(),
    '/api/schedule': () => svc.schedule(),
    '/api/services': () => svc.services(),
    '/api/stats': () => svc.stats(),
    '/api/games': (q) => svc.gamesQuery(q),
    '/api/screenshots': async () => ({ screenshots: svc.screenshots() }),
    // Everything the main view needs in one round trip.
    '/api/overview': async () => {
      const [status, schedule, services, stats] = await Promise.all([svc.status(), svc.schedule(), svc.services(), svc.stats()]);
      return { status, schedule, services, stats, generatedAt: new Date().toISOString() };
    },
  };

  return http.createServer(async (req, res) => {
    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }

    // Health check stays open so Docker's HEALTHCHECK works with auth enabled.
    if (pathname !== '/api/health' && !checkAuth(req, cfg.auth)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="FGC Dashboard", charset="UTF-8"', 'Content-Type': 'text/plain' });
      res.end('Authentication required');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    try {
      if (routes[pathname]) {
        sendJson(res, 200, await routes[pathname](Object.fromEntries(url.searchParams)));
        return;
      }
      if (pathname.startsWith('/api/screenshots/')) {
        const file = svc.screenshotFile(pathname.slice('/api/screenshots/'.length));
        if (file) sendFile(res, file, 'private, max-age=60');
        else sendJson(res, 404, { error: 'not found' });
        return;
      }
      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      // Static UI, confined to PUBLIC_DIR.
      const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.resolve(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
        return;
      }
      sendFile(res, file);
    } catch (err) {
      console.error(`[fgc-dashboard] ${req.method} ${pathname}:`, err);
      sendJson(res, 500, { error: 'internal error' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(`[fgc-dashboard] v${VERSION} listening on http://${cfg.host}:${cfg.port}`);
    console.log(`[fgc-dashboard] data dir: ${cfg.dataDir} | docker: ${cfg.dockerHost || 'disabled'} | auth: ${cfg.auth ? 'basic' : 'off'}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
