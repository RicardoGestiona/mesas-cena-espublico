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
import { emailDomain, normalizeEmail } from "../src/lib/email";
import { TABLE_COUNT, VENUE, isValidTable } from "../src/lib/venue";
import { hmacEmail } from "../src/server/crypto";
import { EnvSchema } from "../src/server/env-schema";
import { SEATING_HASH_KEY } from "../src/server/seating-format";

const STAGING_KEY = `${SEATING_HASH_KEY}:staging`;
const CHUNK_SIZE = 200;

const ArgsSchema = z.object({
  input: z.string().min(1),
  target: z.enum(["memory", "redis"]),
  "expires-at": z.iso.datetime({ offset: true }).optional(),
});

class ImportError extends Error {}

function parseCsv(content: string): { header: string[]; rows: { line: number; cells: string[] }[] } {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const rows: { line: number; cells: string[] }[] = [];
  lines.slice(1).forEach((raw, i) => {
    if (raw.trim() === "") return;
    if (raw.includes('"')) throw new ImportError(`line ${i + 2}: quoted fields are not supported`);
    rows.push({ line: i + 2, cells: raw.split(",") });
  });
  return { header, rows };
}

function buildSeating(csv: string, allowedDomains: string[], pepper: string): Map<string, number> {
  const { header, rows } = parseCsv(csv);
  const emailCol = header.indexOf("email");
  const tableCol = header.indexOf("table");
  if (emailCol === -1 || tableCol === -1) throw new ImportError("header must contain 'email' and 'table'");

  const errors: string[] = [];
  const seating = new Map<string, number>();
  const occupancy = new Map<number, number>();

  for (const { line, cells } of rows) {
    const email = normalizeEmail(cells[emailCol] ?? "");
    const table = Number((cells[tableCol] ?? "").trim());
    if (!z.email().safeParse(email).success) errors.push(`line ${line}: invalid email`);
    else if (!allowedDomains.includes(emailDomain(email))) errors.push(`line ${line}: domain not allowed`);
    if (!isValidTable(table)) errors.push(`line ${line}: table must be 1..${TABLE_COUNT}`);

    const digest = hmacEmail(email, pepper);
    if (seating.has(digest)) errors.push(`line ${line}: duplicate email`);
    seating.set(digest, table);
    occupancy.set(table, (occupancy.get(table) ?? 0) + 1);
  }

  for (const [table, seats] of occupancy) {
    if (seats > VENUE.seatsPerTable) errors.push(`table ${table}: ${seats} attendees exceed ${VENUE.seatsPerTable} seats`);
  }
  if (seating.size === 0) errors.push("no rows found");
  if (errors.length > 0) throw new ImportError(`${errors.length} validation error(s):\n  ${errors.join("\n  ")}`);
  return seating;
}

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
