// Read-only access to FGC-R's SQLite database (data/fgc.db, table claimed_games).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** Map FGC-R's raw status strings to a small set of display groups. */
export function statusGroup(status) {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'claimed' || s === 'claimed and redeemed' || s.startsWith('claimed ')) return 'claimed';
  if (s === 'existed' || s === 'already redeemed' || s === 'owned') return 'owned';
  if (s === 'unknown' || s === '' || s.startsWith('available')) return 'pending';
  if (s.startsWith('failed') || /fail|error|could not|unable|timeout|blocked/.test(s)) return 'failed';
  return 'info'; // free_to_play, not_steam, notified, skipped:*, download-only, ...
}

/** FGC-R stores naive UTC timestamps ('YYYY-MM-DD HH:MM:SS[.ffffff]'); return ISO-8601 Z or null. */
export function normalizeTimestamp(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  const frac = m[3] ? m[3].slice(0, 4) : '';
  let tz = m[4] || 'Z';
  if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}${frac}${tz}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Same masking style as FGC-R's mask_account: p***@gmail.com */
export function maskAccount(user) {
  const u = String(user ?? '');
  const at = u.indexOf('@');
  if (at > 0) return `${u[0]}***${u.slice(at)}`;
  return u;
}

// FGC-R records Prime Gaming's redemption store in lowercase ("gog", "epic games", "legacy games").
const STORE_NAMES = { gog: 'GOG', 'gog.com': 'GOG', 'epic games': 'Epic Games', epic: 'Epic Games', 'legacy games': 'Legacy Games',
  'microsoft store': 'Microsoft Store', xbox: 'Xbox', steam: 'Steam', ubisoft: 'Ubisoft', 'ubisoft connect': 'Ubisoft Connect',
  'ea app': 'EA app', origin: 'Origin', 'amazon games': 'Amazon Games', 'battle.net': 'Battle.net' };

export function prettyStoreName(name) {
  if (!name) return null;
  const n = String(name).trim();
  const known = STORE_NAMES[n.toLowerCase()];
  if (known) return known;
  // Only re-case all-lowercase values; leave anything with deliberate casing alone.
  return n === n.toLowerCase() ? n.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : n;
}

function parseExtra(extra) {
  if (!extra) return null;
  try {
    const v = JSON.parse(extra);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export class GamesDb {
  constructor(file) {
    this.file = file;
    this.db = null;
  }

  #open() {
    const st = fs.statSync(this.file); // throws ENOENT if the claimer has not created it yet
    // Re-open if the file was replaced (e.g. volume restore); otherwise reuse the connection.
    if (this.db && st.ino === this.ino) return this.db;
    this.close();
    this.db = new DatabaseSync(this.file, { readOnly: true, timeout: 3000 });
    this.ino = st.ino;
    return this.db;
  }

  close() {
    try { this.db?.close(); } catch { /* ignore */ }
    this.db = null;
  }

  exists() {
    return fs.existsSync(this.file);
  }

  /** All rows, normalised. The table is small (one row per game per account). */
  allGames() {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = this.#open()
          .prepare('SELECT id, store, user, game_id, title, url, status, code, extra, created_at, updated_at FROM claimed_games')
          .all();
        return rows.map((r) => {
          const extra = parseExtra(r.extra);
          const created = normalizeTimestamp(r.created_at);
          const updated = normalizeTimestamp(r.updated_at);
          return {
            id: r.id,
            store: String(r.store ?? '').toLowerCase(),
            user: r.user ?? '',
            gameId: r.game_id,
            title: r.title || r.game_id,
            url: r.url || null,
            status: r.status ?? 'unknown',
            group: statusGroup(r.status),
            code: r.code || null,
            externalStore: prettyStoreName(extra?.external_store ?? extra?.store ?? null),
            createdAt: created,
            updatedAt: updated,
            // When the outcome was recorded: rows are created first and updated with the result.
            at: updated || created,
          };
        });
      } catch (err) {
        lastErr = err;
        if (err.code === 'ENOENT') throw err;
        if (/no such table/i.test(err.message)) return [];
        this.close();
      }
    }
    throw lastErr;
  }
}
