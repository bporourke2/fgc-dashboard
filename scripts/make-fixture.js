// Create a sample FGC-R data directory (fgc.db with the real schema, screenshots, browser profiles, config.env).
// Usage: node scripts/make-fixture.js <dir>
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = path.resolve(process.argv[2] || 'demo-data');
fs.mkdirSync(dir, { recursive: true });
const dbFile = path.join(dir, 'fgc.db');
fs.rmSync(dbFile, { force: true });

const db = new DatabaseSync(dbFile);
// DDL as emitted by SQLAlchemy for FGC-R's src/core/database.py ClaimedGame model.
db.exec(`
CREATE TABLE claimed_games (
  id INTEGER NOT NULL,
  store VARCHAR(32) NOT NULL,
  user VARCHAR(128) NOT NULL,
  game_id VARCHAR(256) NOT NULL,
  title VARCHAR(512) NOT NULL,
  url TEXT,
  status VARCHAR(64) NOT NULL,
  code VARCHAR(128),
  extra TEXT,
  created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX ix_claimed_games_store ON claimed_games (store);
CREATE INDEX ix_claimed_games_user ON claimed_games (user);
CREATE INDEX ix_claimed_games_game_id ON claimed_games (game_id);
`);

const now = Date.now();
const ts = (daysAgo, micro = false) => {
  const s = new Date(now - daysAgo * 86400_000).toISOString().replace('T', ' ').replace('Z', '');
  return micro ? `${s.slice(0, 19)}.123456` : s.slice(0, 19);
};

const rows = [
  ['epic', 'GamerDude', 'hogwarts-legacy', 'Hogwarts Legacy', 'https://store.epicgames.com/p/hogwarts-legacy', 'claimed', null, null, 1, true],
  ['epic', 'GamerDude', 'control', 'Control', 'https://store.epicgames.com/p/control', 'claimed', null, null, 8],
  ['epic', 'GamerDude', 'death-stranding', 'Death Stranding', 'https://store.epicgames.com/p/death-stranding', 'existed', null, null, 15],
  ['epic', 'GamerDude', 'some-dlc', 'Some DLC Pack', 'https://store.epicgames.com/p/some-dlc', 'failed:missing_base', null, null, 22],
  ['epic', 'GamerDude', 'mystery-game', 'mystery-game', 'https://store.epicgames.com/p/mystery-game', 'unknown', null, null, 0.2],
  ['epic', 'GamerDude', 'alan-wake', 'Alan Wake', 'https://store.epicgames.com/p/alan-wake', 'claimed', null, null, 40],
  ['epic', 'GamerDude', 'tunic', 'Tunic', 'https://store.epicgames.com/p/tunic', 'claimed', null, null, 70],
  ['epic', 'GamerDude', 'hades', 'Hades', 'https://store.epicgames.com/p/hades', 'claimed', null, null, 130],
  ['fab', 'GamerDude', 'uid-123', 'Medieval Village Pack', 'https://www.fab.com/listings/uid-123', 'claimed', null, null, 3],
  ['fab', 'GamerDude', 'uid-456', 'Stylized Trees', 'https://www.fab.com/listings/uid-456', 'existed', null, null, 33],
  ['prime', 'p.someone@gmail.com', 'Fallout 3: GOTY', 'Fallout 3: GOTY', 'https://luna.amazon.com/claims/fallout-3', 'claimed and redeemed', 'ABCD-EFGH-IJKL', '{"external_store":"gog"}', 5],
  ['prime', 'p.someone@gmail.com', 'Star Wars: KOTOR', 'Star Wars: KOTOR', 'https://luna.amazon.com/claims/kotor', 'claimed', 'WXYZ-1234-5678', '{"external_store":"legacy games"}', 12],
  ['prime', 'p.someone@gmail.com', 'Quake II', 'Quake II', 'https://luna.amazon.com/claims/quake-2', 'existed', null, null, 60],
  ['gog', 'GogFan', 'Flatout', 'FlatOut', 'https://www.gog.com/en/game/flatout', 'claimed', null, null, 9],
  ['gog', 'GogFan', 'Beyond Good and Evil', 'Beyond Good and Evil', 'https://www.gog.com/en/game/beyond_good_and_evil', 'Giveaway button not found', null, null, 45],
  ['steam', 'steamuser', '1234560', 'Free Weekend Game', 'https://store.steampowered.com/app/1234560', 'claimed', null, null, 2],
  ['steam', 'steamuser', '570', 'Dota 2', 'https://store.steampowered.com/app/570', 'free_to_play', null, null, 20],
  ['steam', 'steamuser', 'https://www.gamerpower.com/x', 'Some Giveaway', 'https://www.gamerpower.com/x', 'not_steam', null, null, 25],
  ['ubisoft', 'UbiPlayer', 'splinter-cell', 'Splinter Cell', 'https://store.ubisoft.com/splinter-cell', 'claimed', null, null, 100],
  ['itchio', 'itchy', 'dev.itch.io/cool-game', 'Cool Indie Game', 'https://dev.itch.io/cool-game', 'claimed', null, null, 4],
];

const ins = db.prepare(`INSERT INTO claimed_games (store, user, game_id, title, url, status, code, extra, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const [store, user, gid, title, url, status, code, extra, days, micro] of rows) {
  ins.run(store, user, gid, title, url, status, code, extra, ts(days + 0.01), ts(days, micro));
}
db.close();

// Screenshots of failures, as written by FGC-R.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
for (const [store, name] of [['epic', 'epic_failed_some-dlc.png'], ['gog', 'gog_failed_beyond-good-and-evil.png']]) {
  fs.mkdirSync(path.join(dir, 'screenshots', store), { recursive: true });
  fs.writeFileSync(path.join(dir, 'screenshots', store, name), png);
}
for (const p of ['epic', 'prime', 'gog', 'steam']) fs.mkdirSync(path.join(dir, 'browser', p), { recursive: true });

fs.writeFileSync(
  path.join(dir, 'config.env'),
  `# Sample FGC-R configuration
STORES=steam,epic,fab,prime,gog,ubisoft,itchio
EG_EMAIL=someone@example.com
EG_PASSWORD="secret"
EG_OTP_KEY=ABC
PG_EMAIL=someone@example.com
PG_PASSWORD=secret
GOG_EMAIL=someone@example.com
GOG_PASSWORD=secret
STEAM_USERNAME=steamuser
STEAM_PASSWORD=secret
SCHEDULER_HOURS=12
SCHEDULER_FIXED_TIMES=08:00,20:00
SCHEDULER_TIMEZONE=Europe/Warsaw
NOTIFY=discord://webhook_id/webhook_token
`,
);

console.log(`Fixture written to ${dir}`);
