import "server-only";
import { Redis } from "@upstash/redis";
import type { z } from "zod";
import { EnvSchema, missingRedisCredentials } from "./env-schema";
import { resolveRedisCredentials, type RedisCredentials } from "./redis-credentials";

export type ServerEnv = z.infer<typeof EnvSchema> & {
  /** Present iff SEATING_STORE=redis (validated). */
  redis: RedisCredentials | null;
};

/** Misconfiguration. `fields` holds variable NAMES only (never values): safe to log. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(readonly fields: string[]) {
    super(`Invalid server environment: ${fields.join(", ")}`);
  }
}

let cached: ServerEnv | undefined;

/** Validated server-side environment. Throws on misconfiguration (fail fast). */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    const fields = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join("."));
    const redisIssue = missingRedisCredentials(process.env);
    if (redisIssue) fields.push(redisIssue);
    if (parsed.success && process.env.NODE_ENV === "production" && parsed.data.SEATING_STORE !== "redis") {
      fields.push("SEATING_STORE");
    }
    if (!parsed.success || fields.length > 0) throw new ConfigError([...new Set(fields)]);

    const redis = resolveRedisCredentials(process.env);
    cached = {
      ...parsed.data,
      redis: parsed.data.SEATING_STORE === "redis" && redis.ok ? redis.credentials : null,
    };
  }
  return cached;
}

/** Explicit client from validated credentials (no implicit `Redis.fromEnv()` name guessing). */
export function redisClient(env: ServerEnv): Redis {
  if (!env.redis) throw new ConfigError(["SEATING_STORE"]);
  return new Redis({ url: env.redis.url, token: env.redis.token });
}
