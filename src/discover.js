// Learn which stores the running claimer supports by reading its own source
// (main.py: ALL_CLAIMERS, SIDE_STORES, DEFAULT_STORES, _ALIASES; src/core/config.py: credential env vars).
// New FGC-R stores then show up without a dashboard release; the built-in catalog only adds polish.
import { STORES, makeCatalog } from './stores.js';

const strings = (text) => [...String(text).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);

/** Parse the store registry out of FGC-R's main.py. Returns null if it doesn't look like FGC-R. */
export function parseMainPy(text) {
  // Dict bodies end at a line holding only "}", so nested parentheses inside entries are fine.
  const claimersBody = text.match(/^ALL_CLAIMERS\b[^=\n]*=\s*\{([\s\S]*?)^\}/m)?.[1];
  if (!claimersBody) return null;
  const claimers = [...claimersBody.matchAll(/["'](\w+)["']\s*:\s*\(\s*["']([^"']+)["']/g)].map((m) => ({ id: m[1], label: m[2] }));
  if (!claimers.length) return null;

  const aliasesBody = text.match(/^_ALIASES\b[^=\n]*=\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';
  const aliases = {};
  for (const m of aliasesBody.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) aliases[m[1].toLowerCase()] = m[2];

  return {
    claimers,
    sides: strings(text.match(/^SIDE_STORES\b[^=\n]*=\s*\(([^)]*)\)/m)?.[1] ?? ''),
    defaults: strings(text.match(/^DEFAULT_STORES\b[^=\n]*=\s*\[([^\]]*)\]/m)?.[1] ?? ''),
    aliases,
  };
}

// Config attribute prefixes that aren't a store id or alias.
const PREFIX_TO_STORE = { eg: 'epic', pg: 'prime' };

/**
 * Credential env vars per store from src/core/config.py, e.g.
 *   ms_email: str | None = os.getenv("MS_EMAIL") or os.getenv("EMAIL")
 *   ms_otp_key: str | None = _secret("MS_OTP_KEY")
 * @returns {Record<string, {user:string[], pass:string[], otp:string[]}>}
 */
export function parseConfigPy(text, aliases = {}) {
  const out = {};
  const re = /^\s+([a-z0-9]+)_(email|username|password|otp_key|otp_codes)\s*:[^=\n]*=\s*(.+)$/gm;
  for (const m of String(text).matchAll(re)) {
    const prefix = m[1];
    const store = PREFIX_TO_STORE[prefix] ?? aliases[prefix] ?? prefix;
    const vars = strings(m[3]).filter((v) => /^[A-Z][A-Z0-9_]*$/.test(v));
    if (!vars.length) continue;
    const kind = m[2] === 'password' ? 'pass' : m[2].startsWith('otp') ? 'otp' : 'user';
    const entry = (out[store] ??= { user: [], pass: [], otp: [] });
    for (const v of vars) if (!entry[kind].includes(v)) entry[kind].push(v);
  }
  return out;
}

/** Merge what the claimer says it supports with the built-in catalog's labels and links. */
export function buildCatalog(main, creds = {}, version = null) {
  const builtin = new Map(STORES.map((s) => [s.id, s]));
  const ids = [...main.claimers.map((c) => c.id), ...main.sides];
  const labels = Object.fromEntries(main.claimers.map((c) => [c.id, c.label]));
  const defaults = main.defaults.filter((id) => ids.includes(id));

  const stores = ids.map((id) => {
    const known = builtin.get(id);
    const c = creds[id];
    let cred = known?.cred ?? [];
    let otp = known?.otp ?? [];
    if (c && (c.user.length || c.pass.length)) {
      cred = [c.user, c.pass].filter((list) => list.length);
      otp = c.otp;
    }
    return {
      id,
      label: known?.label ?? labels[id] ?? id,
      aliases: Object.entries(main.aliases).filter(([a, target]) => target === id && a !== id).map(([a]) => a),
      optIn: !defaults.includes(id),
      cred,
      otp,
      profile: known?.profile ?? id,
      url: known?.url ?? null,
      note: known?.note ?? null,
      discovered: !known,
    };
  });
  return makeCatalog(stores, defaults, version ? `claimer ${version}` : 'claimer');
}

/** Minimal tar reader for Docker's archive endpoint: returns the first regular file's contents. */
export function firstFileFromTar(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const start = off + 512;
    if (type === '0' || type === '\0') return buf.subarray(start, start + size).toString('utf8');
    off = start + Math.ceil(size / 512) * 512; // skip pax/long-name/dir entries
  }
  return null;
}
