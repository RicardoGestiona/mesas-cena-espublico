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
});
