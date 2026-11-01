/**
 * Imports a seating CSV into the store as `HMAC(email) -> { table, tablemates }`.
 * Emails never leave this process; names and companies are stored only as the
 * tablemates shown to other attendees of the same table.
 * The import is all-or-nothing: any invalid row aborts it.
 * Redis imports are verified against the deployed app (--verify-url, default APP_URL)
 * with a few attendees from the CSV; on failure the previous dataset is restored.
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
import { resolveRedisCredentials } from "../src/server/redis-credentials";
import type { SeatEntry } from "../src/server/seating-format";
import { ImportError, buildSeating, sampleProbes } from "../src/server/seating-import";
import { publishSeating, type SeatingStoreAdmin } from "../src/server/seating-publish";
import { VerifyUrlSchema, createHttpVerifier } from "../src/server/seating-verify";

const ArgsSchema = z.object({
  input: z.string().min(1),
  target: z.enum(["memory", "redis"]),
  "expires-at": z.iso.datetime({ offset: true }).optional(),
  "verify-url": VerifyUrlSchema.optional(),
});

function upstashAdmin(redis: Redis): SeatingStoreAdmin {
  return {
    exists: async (key) => (await redis.exists(key)) === 1,
    del: async (key) => void (await redis.del(key)),
    hset: async (key, fields) => void (await redis.hset(key, fields)),
    expireAt: async (key, unixSeconds) => void (await redis.expireat(key, unixSeconds)),
    atomicRename: async (pairs) => {
      const tx = redis.multi();
      for (const [from, to] of pairs) tx.rename(from, to);
      await tx.exec();
    },
  };
}

async function writeRedis(
  csv: string,
  seating: Map<string, SeatEntry>,
  expiresAt: string | undefined,
  verifyUrl: string | undefined,
): Promise<void> {
  if (!expiresAt) throw new ImportError("--expires-at is required for redis (data must self-delete after the event)");
  if (!verifyUrl) throw new ImportError("--verify-url (or APP_URL) is required for redis to verify the import end-to-end");
  const expireUnix = Math.floor(new Date(expiresAt).getTime() / 1000);
  if (expireUnix <= Date.now() / 1000) throw new ImportError("--expires-at must be in the future");

  const credentials = resolveRedisCredentials(process.env);
  if (!credentials.ok) throw new ImportError(`Redis credentials ${credentials.reason}: ${credentials.field}`);
  const { url, token } = credentials.credentials;

  await publishSeating({
    store: upstashAdmin(new Redis({ url, token })),
    seating,
    expireUnix,
    probes: sampleProbes(csv),
    verify: createHttpVerifier(verifyUrl),
  });
}

function writeMemory(seating: Map<string, SeatEntry>, file: string): void {
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
      "verify-url": { type: "string", default: process.env.APP_URL },
    },
  });
  const args = ArgsSchema.parse(values);

  const csv = readFileSync(args.input, "utf8");
  const seating = buildSeating(csv, env.ALLOWED_EMAIL_DOMAINS, env.EMAIL_HMAC_PEPPER);
  if (args.target === "redis") await writeRedis(csv, seating, args["expires-at"], args["verify-url"]);
  else writeMemory(seating, env.SEATING_MEMORY_FILE);

  const tables = new Set([...seating.values()].map((entry) => entry.table)).size;
  const verified = args.target === "redis";
  console.log(JSON.stringify({ event: "seating.imported", target: args.target, attendees: seating.size, tables, verified }));
}

main().catch((error: unknown) => {
  const message = error instanceof ImportError || error instanceof z.ZodError ? error.message : "unexpected failure";
  console.error(JSON.stringify({ event: "seating.import_failed", message }));
  process.exit(1);
});
