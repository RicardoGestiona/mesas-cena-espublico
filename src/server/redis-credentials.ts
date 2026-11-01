/**
 * Resolves Upstash REST credentials from the environment, tolerating the
 * Vercel Marketplace "Custom Prefix" (which cannot be left empty and yields
 * names like `<PREFIX>_KV_REST_API_URL`). Shared by runtime and scripts, so no
 * `server-only`. Errors carry variable NAMES only.
 *
 * Resolution order:
 *   1. KV_REST_API_URL + KV_REST_API_TOKEN
 *   2. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   3. exactly one pair <P>_KV_REST_API_URL + <P>_KV_REST_API_TOKEN sharing <P>
 * More than one prefixed pair is ambiguous and rejected rather than guessed.
 */

export interface RedisCredentials {
  url: string;
  token: string;
  /** Variable name the URL came from (for diagnostics; never the value). */
  source: string;
}

export type RedisCredentialsResult =
  | { ok: true; credentials: RedisCredentials }
  | { ok: false; reason: "missing" | "ambiguous"; field: string };

export const REDIS_CREDENTIALS_FIELD = "KV_REST_API_URL+KV_REST_API_TOKEN";

const URL_SUFFIX = "KV_REST_API_URL";
const TOKEN_SUFFIX = "KV_REST_API_TOKEN";

type Env = Record<string, string | undefined>;

function value(env: Env, key: string): string | undefined {
  const v = env[key];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function pair(env: Env, urlKey: string, tokenKey: string): RedisCredentials | null {
  const url = value(env, urlKey);
  const token = value(env, tokenKey);
  return url && token ? { url, token, source: urlKey } : null;
}

export function resolveRedisCredentials(env: Env): RedisCredentialsResult {
  const direct =
    pair(env, URL_SUFFIX, TOKEN_SUFFIX) ?? pair(env, "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
  if (direct) return { ok: true, credentials: direct };

  const prefixed = Object.keys(env)
    .filter((key) => key.endsWith(`_${URL_SUFFIX}`))
    .map((urlKey) => pair(env, urlKey, `${urlKey.slice(0, -URL_SUFFIX.length)}${TOKEN_SUFFIX}`))
    .filter((found): found is RedisCredentials => found !== null);

  if (prefixed.length === 1) return { ok: true, credentials: prefixed[0] };
  if (prefixed.length > 1) {
    return { ok: false, reason: "ambiguous", field: `${REDIS_CREDENTIALS_FIELD}(ambiguous:${prefixed.map((c) => c.source).join("|")})` };
  }
  return { ok: false, reason: "missing", field: REDIS_CREDENTIALS_FIELD };
}
