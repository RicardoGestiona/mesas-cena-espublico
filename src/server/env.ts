import "server-only";
import type { z } from "zod";
import { EnvSchema } from "./env-schema";

export type ServerEnv = z.infer<typeof EnvSchema>;

let cached: ServerEnv | undefined;

/** Validated server-side environment. Throws on misconfiguration (fail fast). */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment: ${fields}`);
    }
    if (process.env.NODE_ENV === "production" && parsed.data.SEATING_STORE !== "redis") {
      throw new Error("SEATING_STORE must be 'redis' in production");
    }
    cached = parsed.data;
  }
  return cached;
}
