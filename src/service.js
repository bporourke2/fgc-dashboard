// Aggregates config, database and Docker into the shapes the API returns.
import fs from 'node:fs';
import path from 'node:path';
import { Cached } from './cache.js';
import { GamesDb, maskAccount } from './db.js';
import { DockerClient, parseRuns, summarizeRuns } from './docker.js';
import { envArrayToObject, readEnvFiles, summarize } from './fgcConfig.js';
import { computeSchedule } from './schedule.js';
import { storeById } from './stores.js';

const GROUPS = ['claimed', 'owned', 'failed', 'pending', 'info'];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export class DashboardService {
  constructor(cfg) {
    this.cfg = cfg;
    this.db = new GamesDb(cfg.dbPath);
    this.docker = new DockerClient(cfg.dockerHost, cfg.container);
    const ttl = cfg.cacheSeconds * 1000;
    this.games = new Cached(ttl, () => this.db.allGames());
    this.container = new Cached(ttl, () => this.docker.inspect());
    this.runs = new Cached(Math.max(ttl, 30_000), () => this.#loadRuns());
  }

  async #safe(cached) {
    try {
      return { value: await cached.get(), error: cached.error ? cached.error.message : null };
    } catch (err) {
      return { value: null, error: err.code === 'ENOENT' ? 'not-found' : err.message };
    }
  }

  async containerInfo() {
    if (!this.docker.enabled) return { value: null, error: null };
    return this.#safe(this.container);
  }

  /** Claimer env: the running container's env when Docker is available, else the mounted .env file. */
  async fgcConfig() {
    const c = await this.containerInfo();
    if (c.value) return summarize(envArrayToObject(c.value.env), 'container');
    const { vars, used } = readEnvFiles(this.cfg.envFiles);
    return summarize(vars, used.length ? used.join(' + ') : 'defaults');
  }

  async #loadRuns() {
    const c = await this.container.get();
    if (!c.startedAt) return summarizeRuns([]);
    const cfg = summarize(envArrayToObject(c.env), 'container');
    // Look back far enough to see at least one full scheduling cycle.
    const lookback = Math.max(72, cfg.schedule.intervalHours * 2 + 24) * 3600_000;
    const since = Math.max(Date.parse(c.startedAt), Date.now() - lookback);
    return summarizeRuns(parseRuns(await this.docker.logs(since)));
  }

  async gamesList() {
    const r = await this.#safe(this.games);
    return { rows: r.value ?? [], error: r.error, stale: this.games.stale };
  }

  lastActivity(rows) {
    let max = 0;
    for (const g of rows) if (g.at) max = Math.max(max, Date.parse(g.at));
    return max || null;
  }

  async status() {
    const [c, games] = await Promise.all([this.containerInfo(), this.gamesList()]);
    let runs = null;
    let runsError = null;
    if (c.value) {
      const r = await this.#safe(this.runs);
      runs = r.value;
      runsError = r.error;
    }
    const ci = c.value;
    const envObj = ci ? envArrayToObject(ci.env) : {};
    const la = this.lastActivity(games.rows);
    return {
      docker: this.docker.enabled ? (c.error ? 'error' : 'enabled') : 'disabled',
      dockerError: c.error,
      container: ci
        ? {
            name: ci.name,
            image: ci.image,
            state: ci.state,
            running: ci.running,
            health: ci.health,
            startedAt: ci.startedAt,
            restartCount: ci.restartCount,
            version: ci.labels['org.opencontainers.image.version'] || null,
            commit: envObj.COMMIT ? envObj.COMMIT.slice(0, 7) : null,
            branch: envObj.BRANCH || null,
          }
        : null,
      run: runs ? { inProgress: runs.inProgress, current: runs.current, last: runs.lastRun, history: runs.history } : null,
      runError: runsError,
      lastActivity: la ? new Date(la).toISOString() : null,
      database: games.error === 'not-found' ? 'missing' : games.error ? 'error' : 'ok',
      databaseError: games.error && games.error !== 'not-found' ? games.error : null,
      stale: games.stale,
      dryRun: (await this.fgcConfig()).dryRun,
    };
  }

  async schedule() {
    const [cfg, c, games] = await Promise.all([this.fgcConfig(), this.containerInfo(), this.gamesList()]);
    let lastRunStart = null;
    if (c.value) {
      const r = await this.#safe(this.runs);
      const last = r.value?.lastRun;
      lastRunStart = last ? Date.parse(last.start) : null;
    }
    const startedAt = c.value?.running && c.value.startedAt ? Date.parse(c.value.startedAt) : null;
    return {
      ...computeSchedule(cfg.schedule, { startedAt, lastActivity: lastRunStart ?? this.lastActivity(games.rows) }),
      containerRunning: c.value ? c.value.running : null,
      source: cfg.source,
    };
  }

  async services() {
    const [cfg, games] = await Promise.all([this.fgcConfig(), this.gamesList()]);
    const stats = new Map();
    for (const g of games.rows) {
      let s = stats.get(g.store);
      if (!s) stats.set(g.store, (s = { counts: Object.fromEntries(GROUPS.map((k) => [k, 0])), lastClaim: null, accounts: new Set() }));
      s.counts[g.group]++;
      if (g.user) s.accounts.add(this.cfg.maskAccounts ? maskAccount(g.user) : g.user);
      if (g.group === 'claimed' && g.at && (!s.lastClaim || g.at > s.lastClaim)) s.lastClaim = g.at;
    }
    const empty = { counts: Object.fromEntries(GROUPS.map((k) => [k, 0])), lastClaim: null, accounts: new Set() };
    const list = cfg.stores.map((s) => {
      const st = stats.get(s.id) ?? empty;
      return {
        ...s,
        profileExists: fs.existsSync(path.join(this.cfg.browserDir, s.profile)),
        counts: st.counts,
        lastClaim: st.lastClaim,
        accounts: [...st.accounts],
      };
    });
    // Stores present in the DB but unknown to this dashboard version.
    for (const [id, st] of stats) {
      if (storeById(id)) continue;
      list.push({
        id, label: id, url: null, note: 'Unknown store', optIn: false, enabled: null,
        credentialsConfigured: null, otpConfigured: false, profile: null, profileExists: false,
        counts: st.counts, lastClaim: st.lastClaim, accounts: [...st.accounts],
      });
    }
    return {
      source: cfg.source,
      storesExplicit: cfg.storesExplicit,
      unknownStores: cfg.unknownStores,
      notify: cfg.notify,
      dryRun: cfg.dryRun,
      services: list,
    };
  }

  #publicGame(g) {
    return {
      id: g.id,
      store: g.store,
      storeLabel: storeById(g.store)?.label ?? g.store,
      user: this.cfg.maskAccounts ? maskAccount(g.user) : g.user,
      title: g.title,
      url: safeUrl(g.url),
      status: g.status,
      group: g.group,
      externalStore: g.externalStore,
      hasCode: Boolean(g.code),
      code: this.cfg.showCodes ? g.code : null,
      at: g.at,
      createdAt: g.createdAt,
    };
  }

  async gamesQuery(q) {
    const games = await this.gamesList();
    let rows = games.rows.map((g) => this.#publicGame(g));
    const facets = {
      stores: countBy(rows, (g) => g.store),
      users: countBy(rows, (g) => g.user),
      groups: countBy(rows, (g) => g.group),
    };
    if (q.store) rows = rows.filter((g) => g.store === q.store);
    if (q.user) rows = rows.filter((g) => g.user === q.user);
    if (q.group) {
      const groups = new Set(String(q.group).split(','));
      rows = rows.filter((g) => groups.has(g.group));
    }
    if (q.q) {
      const needle = String(q.q).toLowerCase();
      rows = rows.filter((g) => g.title.toLowerCase().includes(needle) || (g.externalStore ?? '').toLowerCase().includes(needle));
    }
    const dir = q.dir === 'asc' ? 1 : -1;
    const key = { title: (g) => g.title.toLowerCase(), store: (g) => g.store, status: (g) => g.group }[q.sort] ?? ((g) => g.at ?? '');
    rows.sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0));
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
    return {
      total,
      page,
      pages,
      pageSize,
      facets,
      error: games.error,
      showCodes: this.cfg.showCodes,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  async stats(now = new Date()) {
    const games = await this.gamesList();
    const claimed = games.rows.filter((g) => g.group === 'claimed' && g.at);
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      months.push({ month: d.toISOString().slice(0, 7), count: 0 });
    }
    const byMonth = new Map(months.map((m) => [m.month, m]));
    for (const g of claimed) {
      const m = byMonth.get(g.at.slice(0, 7));
      if (m) m.count++;
    }
    const thisMonth = months[months.length - 1].count;
    const recent = [...claimed].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10).map((g) => this.#publicGame(g));
    return {
      totals: countBy(games.rows, (g) => g.group),
      claimedTotal: claimed.length,
      thisMonth,
      perStore: countBy(claimed, (g) => g.store),
      months,
      recent,
    };
  }

  /** Failure screenshots under data/screenshots/<store>/. */
  screenshots() {
    const root = this.cfg.screenshotsDir;
    const out = [];
    let dirs = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return out;
    }
    const add = (store, rel, full) => {
      const st = fs.statSync(full);
      out.push({ store, name: path.basename(rel), path: rel, size: st.size, mtime: st.mtime.toISOString() });
    };
    for (const d of dirs) {
      if (d.isDirectory()) {
        for (const f of fs.readdirSync(path.join(root, d.name), { withFileTypes: true })) {
          if (f.isFile() && IMAGE_EXT.has(path.extname(f.name).toLowerCase())) add(d.name, `${d.name}/${f.name}`, path.join(root, d.name, f.name));
        }
      } else if (d.isFile() && IMAGE_EXT.has(path.extname(d.name).toLowerCase())) {
        add('other', d.name, path.join(root, d.name));
      }
    }
    return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  }

  /** Resolve a screenshot path safely inside the screenshots directory, or null. */
  screenshotFile(rel) {
    const root = path.resolve(this.cfg.screenshotsDir);
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) return null;
    if (!IMAGE_EXT.has(path.extname(full).toLowerCase())) return null;
    try {
      return fs.statSync(full).isFile() ? full : null;
    } catch {
      return null;
    }
  }
}

function countBy(rows, fn) {
  const out = {};
  for (const r of rows) {
    const k = fn(r);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Only allow http(s) links into the UI. */
function safeUrl(u) {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : null;
  } catch {
    return null;
  }
}
