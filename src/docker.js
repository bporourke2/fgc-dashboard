// Optional, read-only Docker Engine API client (direct socket or tecnativa/docker-socket-proxy).
// Used for: container start time (exact interval schedule), health, real env, and run start/end from logs.
import http from 'node:http';

const RUN_START = /Starting claiming run/i;
const RUN_END = /Claiming run complete/i;
// A run without a completion line older than this is treated as crashed/aborted, not "in progress".
const STALE_RUN_MS = 6 * 3600_000;
const MAX_LOG_BYTES = 32 * 1024 * 1024;
// FGC-R logs verbosely (DEBUG defaults to true); bound by lines so we always keep the newest output.
const MAX_LOG_LINES = 50_000;

export function parseDockerHost(value) {
  if (!value) return null;
  const v = value.trim();
  if (v.startsWith('unix://')) return { socketPath: v.slice('unix://'.length) };
  if (v.startsWith('/')) return { socketPath: v };
  const u = new URL(v.replace(/^tcp:\/\//, 'http://'));
  return { host: u.hostname, port: Number(u.port) || 2375 };
}

function request(target, path, { maxBytes = 4 * 1024 * 1024, timeout = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...target, path, method: 'GET', timeout }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on('close', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          const err = new Error(`Docker API ${res.statusCode}: ${body.toString('utf8').slice(0, 200).trim()}`);
          err.status = res.statusCode;
          reject(err);
        } else {
          resolve(body);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Docker API timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** Docker logs are multiplexed (8-byte frame headers) unless the container has a TTY. */
export function demuxLogs(buf) {
  const looksMultiplexed = buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksMultiplexed) return buf.toString('utf8');
  const parts = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + len));
    i += 8 + len;
  }
  return Buffer.concat(parts).toString('utf8');
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

/**
 * Parse `docker logs --timestamps` output into claiming runs.
 * @returns {{start:string, end:string|null, durationSec:number|null, stores:string|null}[]} oldest first
 */
export function parseRuns(text) {
  const runs = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(ANSI, '');
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s?(.*)$/);
    if (!m) continue;
    const ts = new Date(m[1]).toISOString();
    const msg = m[2];
    if (RUN_START.test(msg)) {
      if (current) runs.push(current); // previous run never logged completion
      const after = msg.split(RUN_START)[1] ?? '';
      const stores = after.replace(/^[\s.…:-]+/, '').replace(/\s+\S+\.py:\d+\s*$/, '').trim();
      current = { start: ts, end: null, durationSec: null, stores: stores || null };
    } else if (RUN_END.test(msg) && current) {
      current.end = ts;
      current.durationSec = Math.round((Date.parse(ts) - Date.parse(current.start)) / 1000);
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

export function summarizeRuns(runs, now = Date.now()) {
  const last = runs[runs.length - 1] ?? null;
  const inProgress = Boolean(last && !last.end && now - Date.parse(last.start) < STALE_RUN_MS);
  const lastCompleted = [...runs].reverse().find((r) => r.end) ?? null;
  return {
    inProgress,
    current: inProgress ? last : null,
    lastRun: lastCompleted,
    // Most recent first, for the history list.
    history: runs.slice(-10).reverse().map((r) => ({ ...r, aborted: !r.end && r !== (inProgress ? last : null) })),
  };
}

export class DockerClient {
  constructor(dockerHost, container) {
    this.target = parseDockerHost(dockerHost);
    this.container = container;
  }

  get enabled() {
    return Boolean(this.target);
  }

  async inspect() {
    const body = await request(this.target, `/containers/${encodeURIComponent(this.container)}/json`);
    const j = JSON.parse(body.toString('utf8'));
    return {
      id: j.Id?.slice(0, 12),
      name: (j.Name || '').replace(/^\//, ''),
      image: j.Config?.Image ?? null,
      labels: j.Config?.Labels ?? {},
      env: j.Config?.Env ?? [],
      state: j.State?.Status ?? 'unknown',
      running: Boolean(j.State?.Running),
      health: j.State?.Health?.Status ?? null,
      startedAt: j.State?.StartedAt && !j.State.StartedAt.startsWith('0001') ? j.State.StartedAt : null,
      restartCount: j.RestartCount ?? 0,
    };
  }

  /** Logs since `sinceMs` (epoch ms), with timestamps. */
  async logs(sinceMs) {
    const since = Math.floor(sinceMs / 1000);
    const body = await request(
      this.target,
      `/containers/${encodeURIComponent(this.container)}/logs?stdout=1&stderr=1&timestamps=1&since=${since}&tail=${MAX_LOG_LINES}`,
      { maxBytes: MAX_LOG_BYTES, timeout: 20_000 },
    );
    return demuxLogs(body);
  }
}
