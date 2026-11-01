import "server-only";
import type { z } from "zod";
import { EnvSchema, missingRedisCredentials } from "./env-schema";

export type ServerEnv = z.infer<typeof EnvSchema>;

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
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join("."));
      const redis = missingRedisCredentials(process.env);
      throw new ConfigError([...new Set(redis ? [...fields, redis] : fields)]);
    }
    if (process.env.NODE_ENV === "production" && parsed.data.SEATING_STORE !== "redis") {
      throw new ConfigError(["SEATING_STORE"]);
    }
    cached = parsed.data;
  }
  return cached;
}
