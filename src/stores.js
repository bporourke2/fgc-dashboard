// Built-in catalog of Free-Games-Claimer-Remaster stores (as of FGC-R v1.11).
// With Docker access, src/discover.js reads the real store list from the running claimer and
// merges it over this; the catalog then only supplies nicer labels, links and credential vars.

/**
 * @typedef {{id:string, label:string, aliases:string[], optIn:boolean, cred:string[][], otp:string[],
 *   profile:string, url:string|null, note?:string|null}} Store
 * cred: each inner array is one required credential, satisfied by any of the listed env vars.
 */

/** @type {Store[]} */
export const STORES = [
  {
    id: 'steam', label: 'Steam', aliases: ['steam-games'], optIn: false,
    cred: [['STEAM_USERNAME'], ['STEAM_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'steam', url: 'https://store.steampowered.com',
  },
  {
    id: 'epic', label: 'Epic Games', aliases: ['epic-games', 'epicgames'], optIn: false,
    cred: [['EG_EMAIL', 'EMAIL'], ['EG_PASSWORD', 'PASSWORD']], otp: ['EG_OTP_KEY', 'EG_OTPKEY', 'EG_OTP_CODES'],
    profile: 'epic', url: 'https://store.epicgames.com',
  },
  {
    id: 'fab', label: 'Fab', aliases: ['epic-fab'], optIn: true,
    cred: [['EG_EMAIL', 'EMAIL'], ['EG_PASSWORD', 'PASSWORD']], otp: ['EG_OTP_KEY', 'EG_OTPKEY', 'EG_OTP_CODES'],
    profile: 'epic', url: 'https://www.fab.com', note: 'Uses the Epic account',
  },
  {
    id: 'prime', label: 'Prime Gaming', aliases: ['prime-gaming', 'primegaming', 'amazon'], optIn: false,
    cred: [['PG_EMAIL', 'EMAIL'], ['PG_PASSWORD', 'PASSWORD']], otp: ['PG_OTP_KEY', 'PG_OTPKEY'],
    profile: 'prime', url: 'https://luna.amazon.com/claims',
  },
  {
    id: 'gog', label: 'GOG', aliases: [], optIn: false,
    cred: [['GOG_EMAIL', 'EMAIL'], ['GOG_PASSWORD', 'PASSWORD']], otp: ['GOG_OTP_KEY', 'GOG_OTP_CODES'],
    profile: 'gog', url: 'https://www.gog.com',
  },
  {
    id: 'microsoft', label: 'Microsoft Store', aliases: ['microsoft-store', 'ms', 'xbox'], optIn: false,
    cred: [['MS_EMAIL', 'EMAIL'], ['MS_PASSWORD', 'PASSWORD']], otp: ['MS_OTP_KEY'],
    profile: 'microsoft', url: 'https://www.microsoft.com/store', note: 'Also redeems Prime Gaming codes',
  },
  {
    id: 'ubisoft', label: 'Ubisoft', aliases: ['ubi'], optIn: false,
    cred: [['UBI_EMAIL', 'EMAIL'], ['UBI_PASSWORD', 'PASSWORD']], otp: ['UBI_OTP_KEY', 'UBI_OTPKEY'],
    profile: 'ubisoft', url: 'https://store.ubisoft.com',
  },
  {
    id: 'aliexpress', label: 'AliExpress', aliases: ['ae'], optIn: false,
    cred: [['AE_EMAIL', 'EMAIL'], ['AE_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'aliexpress', url: 'https://www.aliexpress.com', note: 'Daily coins, no game records',
  },
  {
    id: 'unity', label: 'Unity Asset Store', aliases: ['unity-assets'], optIn: true,
    cred: [['UNITY_EMAIL', 'EMAIL'], ['UNITY_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'unity', url: 'https://assetstore.unity.com',
  },
  {
    id: 'itchio', label: 'itch.io', aliases: ['itch', 'itch.io'], optIn: true,
    cred: [['ITCHIO_EMAIL', 'EMAIL'], ['ITCHIO_PASSWORD', 'PASSWORD']], otp: ['ITCHIO_OTP_KEY', 'ITCHIO_OTP_CODES'],
    profile: 'base', url: 'https://itch.io',
  },
  {
    id: 'fanatical', label: 'Fanatical', aliases: [], optIn: true,
    cred: [['FANATICAL_EMAIL', 'EMAIL'], ['FANATICAL_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'base', url: 'https://www.fanatical.com',
  },
  {
    id: 'indiegala', label: 'IndieGala', aliases: ['indie-gala'], optIn: true,
    cred: [['INDIEGALA_EMAIL', 'EMAIL'], ['INDIEGALA_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'base', url: 'https://freebies.indiegala.com',
  },
  {
    id: 'alienware', label: 'Alienware Arena', aliases: ['alienware-arena', 'awa'], optIn: true,
    cred: [], otp: [],
    profile: 'base', url: 'https://www.alienwarearena.com', note: 'Notify only',
  },
];

export const DEFAULT_STORES = STORES.filter((s) => !s.optIn).map((s) => s.id);

/** Built-in catalog in the same shape discover.js produces. */
export const BUILTIN_CATALOG = makeCatalog(STORES, DEFAULT_STORES, 'built-in');

export function makeCatalog(stores, defaults, source) {
  const alias = new Map();
  for (const s of stores) {
    alias.set(s.id, s.id);
    for (const a of s.aliases) alias.set(a.toLowerCase(), s.id);
  }
  return { stores, defaults, alias, source };
}

/** Resolve a user-supplied store name/alias to a canonical id (or null). */
export function resolveStore(name, catalog = BUILTIN_CATALOG) {
  return catalog.alias.get(String(name).trim().toLowerCase()) ?? null;
}

export function storeById(id, catalog = BUILTIN_CATALOG) {
  return catalog.stores.find((s) => s.id === id) ?? STORES.find((s) => s.id === id);
}
