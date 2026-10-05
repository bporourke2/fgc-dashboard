// Interpret the claimer's environment (from `docker inspect` or its .env file).
// Secret values never leave this module — only booleans and non-sensitive settings.
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_CATALOG, resolveStore } from './stores.js';

/** Minimal dotenv parser: comments, `export`, single/double quotes, inline comments. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2];
    const q = val[0];
    if ((q === '"' || q === "'") && val.lastIndexOf(q) > 0) {
      val = val.slice(1, val.lastIndexOf(q));
      if (q === '"') val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      val = val.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = val;
  }
  return out;
}

/** Turn ["KEY=value", ...] from docker inspect into an object. */
export function envArrayToObject(arr = []) {
  const out = {};
  for (const item of arr) {
    const i = item.indexOf('=');
    if (i > 0) out[item.slice(0, i)] = item.slice(i + 1);
  }
  return out;
}

/** Read the first existing env file; earlier files take precedence per key (like FGC-R). */
export function readEnvFiles(files) {
  const merged = {};
  const used = [];
  for (const f of files) {
    try {
      const vars = parseDotenv(fs.readFileSync(f, 'utf8'));
      for (const [k, v] of Object.entries(vars)) if (!(k in merged)) merged[k] = v;
      used.push(path.basename(f));
    } catch { /* missing file is fine */ }
  }
  return { vars: merged, used };
}

const truthy = (v) => /^(1|true|yes)$/i.test(String(v ?? '').trim());
const has = (env, key) => String(env[key] ?? '').trim() !== '';
const int = (v, def) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : def;
};

/**
 * Which stores will run, following FGC-R's main.py: STORES (names or aliases) or the default list.
 * (The old *_ENABLE switches were removed in FGC-R 1.11 and are ignored here too.)
 */
export function enabledStores(env, catalog = BUILTIN_CATALOG) {
  const set = new Set();
  const unknown = [];
  const list = String(env.STORES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length) {
    for (const name of list) {
      const id = resolveStore(name, catalog);
      if (id) set.add(id);
      // 'gamerpower' is a discovery source, not a store; FGC-R ignores it with a warning.
      else if (!/^(gamerpower|gp)$/i.test(name)) unknown.push(name);
    }
  } else {
    catalog.defaults.forEach((id) => set.add(id));
  }
  return { enabled: set, unknown, explicit: list.length > 0 };
}

export function parseFixedTimes(text) {
  const out = [];
  for (const part of String(text ?? '').split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 24 && mi < 60) out.push({ hour: h, minute: mi });
  }
  out.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return out;
}

/** Summarise the claimer configuration without exposing secrets. */
export function summarize(env, source, catalog = BUILTIN_CATALOG) {
  const { enabled, unknown, explicit } = enabledStores(env, catalog);
  const stores = catalog.stores.map((s) => ({
    id: s.id,
    label: s.label,
    url: s.url,
    note: s.note ?? null,
    optIn: s.optIn,
    enabled: enabled.has(s.id),
    credentialsConfigured: s.cred.length === 0 ? null : s.cred.every((alts) => alts.some((k) => has(env, k))),
    otpConfigured: s.otp.some((k) => has(env, k)),
    profile: s.profile,
    discovered: Boolean(s.discovered),
  }));
  return {
    source,
    catalogSource: catalog.source,
    storesExplicit: explicit,
    unknownStores: unknown,
    stores,
    schedule: {
      intervalHours: Math.max(0, int(env.SCHEDULER_HOURS, 12)),
      fixedTimes: parseFixedTimes(env.SCHEDULER_FIXED_TIMES),
      timezone: String(env.SCHEDULER_TIMEZONE ?? '').trim() || 'UTC',
      runOnStartup: env.RUN_ON_STARTUP === undefined || env.RUN_ON_STARTUP === '' ? true : truthy(env.RUN_ON_STARTUP),
      // FGC-R 1.10+: one claiming run, then the container stops (an outside scheduler drives it).
      runOnce: truthy(env.RUN_ONCE),
    },
    notify: {
      apprise: has(env, 'NOTIFY'),
      discord: has(env, 'DISCORD_WEBHOOK'),
    },
    dryRun: truthy(env.DRYRUN),
  };
}
