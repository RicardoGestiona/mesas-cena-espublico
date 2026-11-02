import "server-only";
import { Redis } from "@upstash/redis";
import type { z } from "zod";
import { EnvSchema, missingRuntimeRedis } from "./env-schema";

/** Least-privilege runtime credentials: one ACL user per duty (see env-schema.ts). */
export interface RuntimeRedisCredentials {
  url: string;
  seatingToken: string;
  ratelimitToken: string;
}

export type RedisRole = "seating" | "ratelimit";

export type ServerEnv = z.infer<typeof EnvSchema> & {
  /** Present iff SEATING_STORE=redis (validated). */
  redis: RuntimeRedisCredentials | null;
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
    fields.push(...missingRuntimeRedis(process.env));
    if (parsed.success && process.env.NODE_ENV === "production" && parsed.data.SEATING_STORE !== "redis") {
      fields.push("SEATING_STORE");
    }
    if (!parsed.success || fields.length > 0) throw new ConfigError([...new Set(fields)]);

    const { RUNTIME_REDIS_URL, RUNTIME_REDIS_SEATING_TOKEN, RUNTIME_REDIS_RATELIMIT_TOKEN } = parsed.data;
    cached = {
      ...parsed.data,
      redis:
        parsed.data.SEATING_STORE === "redis" && RUNTIME_REDIS_URL && RUNTIME_REDIS_SEATING_TOKEN && RUNTIME_REDIS_RATELIMIT_TOKEN
          ? { url: RUNTIME_REDIS_URL, seatingToken: RUNTIME_REDIS_SEATING_TOKEN, ratelimitToken: RUNTIME_REDIS_RATELIMIT_TOKEN }
          : null,
    };
  }
  return cached;
}

/** Explicit client for one duty, holding only that duty's token (no `Redis.fromEnv()`). */
export function redisClient(env: ServerEnv, role: RedisRole): Redis {
  if (!env.redis) throw new ConfigError(["SEATING_STORE"]);
  const token = role === "seating" ? env.redis.seatingToken : env.redis.ratelimitToken;
  return new Redis({ url: env.redis.url, token });
}
