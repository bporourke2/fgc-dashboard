// Catalog of stores supported by Free-Games-Claimer-Remaster (mirrors src/core/selection.py + config.py).

/**
 * @typedef {{id:string, label:string, aliases:string[], optIn:boolean, cred:string[][], otp:string[],
 *   profile:string, url:string, note?:string, legacyFlag?:string}} Store
 * cred: each inner array is one required credential, satisfied by any of the listed env vars.
 */

/** @type {Store[]} */
export const STORES = [
  {
    id: 'steam', label: 'Steam', aliases: [], optIn: false,
    cred: [['STEAM_USERNAME'], ['STEAM_PASSWORD']], otp: [],
    profile: 'steam', url: 'https://store.steampowered.com',
  },
  {
    id: 'epic', label: 'Epic Games', aliases: ['epic-games', 'epicgames', 'eg'], optIn: false,
    cred: [['EG_EMAIL', 'EMAIL'], ['EG_PASSWORD', 'PASSWORD']], otp: ['EG_OTP_KEY', 'EG_OTPKEY', 'EG_OTP_CODES'],
    profile: 'epic', url: 'https://store.epicgames.com',
  },
  {
    id: 'fab', label: 'Fab', aliases: ['epic-fab', 'unreal'], optIn: false,
    cred: [['EG_EMAIL', 'EMAIL'], ['EG_PASSWORD', 'PASSWORD']], otp: ['EG_OTP_KEY', 'EG_OTPKEY', 'EG_OTP_CODES'],
    profile: 'epic', url: 'https://www.fab.com', note: 'Uses the Epic account',
  },
  {
    id: 'prime', label: 'Prime Gaming', aliases: ['amazon', 'prime-gaming', 'primegaming', 'luna', 'pg'], optIn: false,
    cred: [['PG_EMAIL', 'EMAIL'], ['PG_PASSWORD', 'PASSWORD']], otp: ['PG_OTP_KEY', 'PG_OTPKEY'],
    profile: 'prime', url: 'https://luna.amazon.com/claims',
  },
  {
    id: 'gog', label: 'GOG', aliases: ['gog.com'], optIn: false,
    cred: [['GOG_EMAIL', 'EMAIL'], ['GOG_PASSWORD', 'PASSWORD']], otp: ['GOG_OTP_KEY', 'GOG_OTP_CODES'],
    profile: 'gog', url: 'https://www.gog.com',
  },
  {
    id: 'ubisoft', label: 'Ubisoft', aliases: ['ubi', 'uplay'], optIn: false,
    cred: [['UBI_EMAIL', 'EMAIL'], ['UBI_PASSWORD', 'PASSWORD']], otp: ['UBI_OTP_KEY', 'UBI_OTPKEY'],
    profile: 'ubisoft', url: 'https://store.ubisoft.com',
  },
  {
    id: 'aliexpress', label: 'AliExpress', aliases: ['ae', 'ali'], optIn: false,
    cred: [['AE_EMAIL', 'EMAIL'], ['AE_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'aliexpress', url: 'https://www.aliexpress.com', note: 'Daily coins — no game records',
  },
  {
    id: 'unity', label: 'Unity Asset Store', aliases: ['unity-assets', 'unityassetstore'], optIn: true,
    cred: [['UNITY_EMAIL', 'EMAIL'], ['UNITY_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'unity', url: 'https://assetstore.unity.com',
  },
  {
    id: 'itchio', label: 'itch.io', aliases: ['itch', 'itch.io'], optIn: true,
    cred: [['ITCHIO_EMAIL', 'EMAIL'], ['ITCHIO_PASSWORD', 'PASSWORD']], otp: ['ITCHIO_OTP_KEY', 'ITCHIO_OTP_CODES'],
    profile: 'base', url: 'https://itch.io', legacyFlag: 'ITCHIO_ENABLE',
  },
  {
    id: 'fanatical', label: 'Fanatical', aliases: [], optIn: true,
    cred: [['FANATICAL_EMAIL', 'EMAIL'], ['FANATICAL_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'base', url: 'https://www.fanatical.com', legacyFlag: 'FANATICAL_ENABLE',
  },
  {
    id: 'indiegala', label: 'IndieGala', aliases: ['ig'], optIn: true,
    cred: [['INDIEGALA_EMAIL', 'EMAIL'], ['INDIEGALA_PASSWORD', 'PASSWORD']], otp: [],
    profile: 'base', url: 'https://freebies.indiegala.com', legacyFlag: 'INDIEGALA_ENABLE',
  },
  {
    id: 'alienware', label: 'Alienware Arena', aliases: ['awa'], optIn: true,
    cred: [], otp: [],
    profile: 'base', url: 'https://www.alienwarearena.com', note: 'Notify only', legacyFlag: 'ALIENWARE_ENABLE',
  },
];

export const DEFAULT_STORES = STORES.filter((s) => !s.optIn).map((s) => s.id);

const ALIAS = new Map();
for (const s of STORES) {
  ALIAS.set(s.id, s.id);
  for (const a of s.aliases) ALIAS.set(a, s.id);
}

/** Resolve a user-supplied store name/alias to a canonical id (or null). */
export function resolveStore(name) {
  return ALIAS.get(String(name).trim().toLowerCase()) ?? null;
}

export function storeById(id) {
  return STORES.find((s) => s.id === id);
}
