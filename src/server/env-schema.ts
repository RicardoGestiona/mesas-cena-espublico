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

/** Empty strings (e.g. `KEY=` in .env files) count as missing. */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== "" ? value : undefined));

export const EnvSchema = z
  .object({
    EMAIL_HMAC_PEPPER: z.string().min(32, "EMAIL_HMAC_PEPPER must be at least 32 chars"),
    ALLOWED_EMAIL_DOMAINS: domainList,
    SEATING_STORE: z.enum(["redis", "memory"]).default("memory"),
    SEATING_MEMORY_FILE: z.string().default("data/private/seating.hashed.json"),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    // Upstash credentials: Vercel Marketplace names (KV_*) or Upstash console names.
    KV_REST_API_URL: optionalSecret,
    KV_REST_API_TOKEN: optionalSecret,
    UPSTASH_REDIS_REST_URL: optionalSecret,
    UPSTASH_REDIS_REST_TOKEN: optionalSecret,
  })
  .superRefine((env, ctx) => {
    const missing = missingRedisCredentials(env);
    if (missing) ctx.addIssue({ code: "custom", path: [missing], message: "Redis credentials required" });
  });

const REDIS_CREDENTIALS_FIELD = "KV_REST_API_URL+KV_REST_API_TOKEN";

/**
 * Returns the field label to report when SEATING_STORE=redis lacks credentials.
 * Exported because Zod skips object refinements once any field fails, and we
 * want every missing variable reported in a single deploy cycle.
 */
export function missingRedisCredentials(env: Record<string, unknown>): string | null {
  if (env.SEATING_STORE !== "redis") return null;
  const present = (key: string) => typeof env[key] === "string" && (env[key] as string).trim() !== "";
  const hasKv = present("KV_REST_API_URL") && present("KV_REST_API_TOKEN");
  const hasUpstash = present("UPSTASH_REDIS_REST_URL") && present("UPSTASH_REDIS_REST_TOKEN");
  return hasKv || hasUpstash ? null : REDIS_CREDENTIALS_FIELD;
}
