import { describe, expect, it } from "vitest";
import { REDIS_CREDENTIALS_FIELD, resolveRedisCredentials } from "@/server/redis-credentials";

const URL_A = "https://a.upstash.io";
const URL_B = "https://b.upstash.io";

describe("resolveRedisCredentials", () => {
  it("uses the standard Vercel Marketplace names", () => {
    expect(resolveRedisCredentials({ KV_REST_API_URL: URL_A, KV_REST_API_TOKEN: "t" })).toEqual({
      ok: true,
      credentials: { url: URL_A, token: "t", source: "KV_REST_API_URL" },
    });
  });

  it("falls back to Upstash console names", () => {
    const result = resolveRedisCredentials({ UPSTASH_REDIS_REST_URL: URL_A, UPSTASH_REDIS_REST_TOKEN: "t" });
    expect(result).toMatchObject({ ok: true, credentials: { url: URL_A, source: "UPSTASH_REDIS_REST_URL" } });
  });

  it("accepts a Custom Prefix (the real case: prefix KV_REST_API_TOKEN)", () => {
    const env = {
      KV_REST_API_TOKEN_KV_REST_API_URL: URL_A,
      KV_REST_API_TOKEN_KV_REST_API_TOKEN: "write-token",
      KV_REST_API_TOKEN_KV_REST_API_READ_ONLY_TOKEN: "read-only-token",
      KV_REST_API_TOKEN_KV_URL: "rediss://x",
      KV_REST_API_TOKEN_REDIS_URL: "rediss://x",
    };
    expect(resolveRedisCredentials(env)).toEqual({
      ok: true,
      credentials: { url: URL_A, token: "write-token", source: "KV_REST_API_TOKEN_KV_REST_API_URL" },
    });
  });

  it("prefers standard names over prefixed ones", () => {
    const env = { KV_REST_API_URL: URL_A, KV_REST_API_TOKEN: "a", MESAS_KV_REST_API_URL: URL_B, MESAS_KV_REST_API_TOKEN: "b" };
    expect(resolveRedisCredentials(env)).toMatchObject({ ok: true, credentials: { url: URL_A } });
  });

  it("never pairs a URL and token with different prefixes", () => {
    expect(resolveRedisCredentials({ A_KV_REST_API_URL: URL_A, B_KV_REST_API_TOKEN: "b" })).toEqual({
      ok: false,
      reason: "missing",
      field: REDIS_CREDENTIALS_FIELD,
    });
  });

  it("rejects more than one prefixed pair instead of guessing", () => {
    const result = resolveRedisCredentials({
      A_KV_REST_API_URL: URL_A,
      A_KV_REST_API_TOKEN: "a",
      B_KV_REST_API_URL: URL_B,
      B_KV_REST_API_TOKEN: "b",
    });
    expect(result).toMatchObject({ ok: false, reason: "ambiguous" });
    if (!result.ok) {
      expect(result.field).toContain("A_KV_REST_API_URL");
      expect(result.field).not.toContain(URL_A);
    }
  });

  it("treats empty or whitespace values as missing", () => {
    expect(resolveRedisCredentials({ KV_REST_API_URL: "", KV_REST_API_TOKEN: "  " })).toMatchObject({
      ok: false,
      reason: "missing",
    });
  });
});
