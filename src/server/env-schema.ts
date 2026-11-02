import { z } from "zod";

/** Env contract shared by runtime (env.ts) and scripts. No `server-only` so tsx can import it. */
const domainList = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(3)).min(1));

export const EnvSchema = z.object({
  EMAIL_HMAC_PEPPER: z.string().min(32, "EMAIL_HMAC_PEPPER must be at least 32 chars"),
  ALLOWED_EMAIL_DOMAINS: domainList,
  SEATING_STORE: z.enum(["redis", "memory"]).default("memory"),
  SEATING_MEMORY_FILE: z.string().default("data/private/seating.hashed.json"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  // Runtime Redis access (least privilege, two ACL users on the same database):
  // the seating token may only HGET `seating`; the ratelimit token only runs the
  // limiter's Lua on `rl:lookup:*`. Admin credentials (KV_REST_API_*) are for scripts only.
  RUNTIME_REDIS_URL: z.url().optional(),
  RUNTIME_REDIS_SEATING_TOKEN: z.string().trim().min(1).optional(),
  RUNTIME_REDIS_RATELIMIT_TOKEN: z.string().trim().min(1).optional(),
});

export const RUNTIME_REDIS_FIELDS = [
  "RUNTIME_REDIS_URL",
  "RUNTIME_REDIS_SEATING_TOKEN",
  "RUNTIME_REDIS_RATELIMIT_TOKEN",
] as const;

/**
 * Names (never values) of the runtime Redis variables missing or blank when
 * SEATING_STORE=redis. There is deliberately no fallback to admin credentials.
 */
export function missingRuntimeRedis(env: Record<string, string | undefined>): string[] {
  if (env.SEATING_STORE !== "redis") return [];
  return RUNTIME_REDIS_FIELDS.filter((key) => !env[key]?.trim());
}
