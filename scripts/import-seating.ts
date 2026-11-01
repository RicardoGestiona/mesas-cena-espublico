/**
 * Imports a seating CSV into the store, keeping ONLY `HMAC(email) -> table`.
 * Every other column (names, company…) is ignored and never leaves this process.
 * The import is all-or-nothing: any invalid row aborts it.
 *
 * Usage:
 *   npm run seating:import -- --input data/private/seating.csv --target memory
 *   npm run seating:import -- --input data/private/seating.csv --target redis --expires-at 2026-12-20T23:59:00+01:00
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import { EnvSchema } from "../src/server/env-schema";
import { SEATING_HASH_KEY } from "../src/server/seating-format";
import { ImportError, buildSeating } from "../src/server/seating-import";

const STAGING_KEY = `${SEATING_HASH_KEY}:staging`;
const CHUNK_SIZE = 200;

const ArgsSchema = z.object({
  input: z.string().min(1),
  target: z.enum(["memory", "redis"]),
  "expires-at": z.iso.datetime({ offset: true }).optional(),
});

async function writeRedis(seating: Map<string, number>, expiresAt: string | undefined): Promise<void> {
  if (!expiresAt) throw new ImportError("--expires-at is required for redis (data must self-delete after the event)");
  const expireUnix = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (expireUnix <= Date.now() / 1000) throw new ImportError("--expires-at must be in the future");

  const redis = Redis.fromEnv();
  await redis.del(STAGING_KEY);
  const entries = [...seating.entries()];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    await redis.hset(STAGING_KEY, Object.fromEntries(entries.slice(i, i + CHUNK_SIZE)));
  }
  // Atomic swap: readers see either the previous or the new full dataset, never a partial one.
  await redis.multi().rename(STAGING_KEY, SEATING_HASH_KEY).expireat(SEATING_HASH_KEY, expireUnix).exec();
}

function writeMemory(seating: Map<string, number>, file: string): void {
  const outPath = path.resolve(file);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(Object.fromEntries(seating)), "utf8");
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env = EnvSchema.parse(process.env);
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      target: { type: "string", default: env.SEATING_STORE },
      "expires-at": { type: "string" },
    },
  });
  const args = ArgsSchema.parse(values);

  const seating = buildSeating(readFileSync(args.input, "utf8"), env.ALLOWED_EMAIL_DOMAINS, env.EMAIL_HMAC_PEPPER);
  if (args.target === "redis") await writeRedis(seating, args["expires-at"]);
  else writeMemory(seating, env.SEATING_MEMORY_FILE);

  const tables = new Set(seating.values()).size;
  console.log(JSON.stringify({ event: "seating.imported", target: args.target, attendees: seating.size, tables }));
}

main().catch((error: unknown) => {
  const message = error instanceof ImportError || error instanceof z.ZodError ? error.message : "unexpected failure";
  console.error(JSON.stringify({ event: "seating.import_failed", message }));
  process.exit(1);
});
