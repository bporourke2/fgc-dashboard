// Dashboard's own configuration (environment variables of the dashboard container).
import path from 'node:path';

const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(String(v).trim()));

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.FGC_DATA_DIR || '/fgc/data');
  const authUser = env.BASIC_AUTH_USER || '';
  const authPass = env.BASIC_AUTH_PASS || '';
  return {
    port: Number(env.PORT) || 8080,
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbPath: path.join(dataDir, 'fgc.db'),
    screenshotsDir: path.join(dataDir, 'screenshots'),
    browserDir: path.join(dataDir, 'browser'),
    // Optional .env shared with the claimer; FGC-R itself falls back to data/config.env.
    envFiles: [env.FGC_ENV_FILE || '/fgc/.env', path.join(dataDir, 'config.env')],
    container: env.FGC_CONTAINER || 'fgc-remaster',
    dockerHost: env.DOCKER_HOST || '',
    auth: authUser && authPass ? { user: authUser, pass: authPass } : null,
    maskAccounts: bool(env.MASK_ACCOUNTS, true),
    showCodes: bool(env.SHOW_CODES, false),
    cacheSeconds: Number(env.CACHE_SECONDS) || 15,
  };
}
