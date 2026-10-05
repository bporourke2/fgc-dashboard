// Shared fixtures for tests (not a test file itself: the npm script only runs *.test.js).

// Shaped like FGC-R 1.11's main.py, plus a made-up future store ("humble").
export const MAIN_PY = `
ALL_CLAIMERS: dict[str, tuple[str, object]] = {
    "steam":      ("Steam",        claim_steam),
    "epic":       ("Epic Games",   claim_epic),
    "fab":        ("Fab",          claim_fab),
    "microsoft":  ("Microsoft",    claim_microsoft),
    "humble":     ("Humble Bundle", claim_humble),
}

SIDE_STORES: tuple[str, ...] = ("itchio", "fanatical")

GP_TARGETS: tuple[str, ...] = ("steam", "epic", "gog", "microsoft")

DEFAULT_STORES: list[str] = ["steam", "epic", "microsoft", "humble"]

_ALIASES: dict[str, str] = {
    "steam":         "steam",
    "epic":          "epic",
    "epic-games":    "epic",
    "fab":           "fab",
    "microsoft":     "microsoft",
    "ms":            "microsoft",
    "xbox":          "microsoft",
    "humble":        "humble",
    "hb":            "humble",
    "itchio":        "itchio",
    "itch":          "itchio",
    "fanatical":     "fanatical",
    # GamerPower is no longer a store of its own, see _resolve_stores().
    "gamerpower":    "gamerpower",
}
`;

export const CONFIG_PY = `
class Config:
    eg_email: str | None = os.getenv("EG_EMAIL") or os.getenv("EMAIL")
    eg_password: str | None = os.getenv("EG_PASSWORD") or os.getenv("PASSWORD")
    eg_otp_key: str | None = _secret("EG_OTP_KEY", "EG_OTPKEY")
    ms_email: str | None = os.getenv("MS_EMAIL") or os.getenv("EMAIL")
    ms_password: str | None = os.getenv("MS_PASSWORD") or os.getenv("PASSWORD")
    ms_otp_key: str | None = _secret("MS_OTP_KEY")
    steam_username: str | None = os.getenv("STEAM_USERNAME")
    steam_password: str | None = os.getenv("STEAM_PASSWORD") or os.getenv("PASSWORD")
    hb_email: str | None = os.getenv("HB_EMAIL") or os.getenv("EMAIL")
    hb_password: str | None = os.getenv("HB_PASSWORD") or os.getenv("PASSWORD")
    ms_force_redeem: bool = _bool("MS_FORCE_REDEEM")
`;

/** Build a one-file ustar archive like Docker's /archive endpoint returns. */
export function tarOf(name, content) {
  const data = Buffer.from(content);
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write('0000644\0', 100);
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write('        ', 148);
  h[156] = 48; // '0' regular file
  h.write('ustar\0', 257);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([h, data, pad, Buffer.alloc(1024)]);
}
