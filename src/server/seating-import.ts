import { z } from "zod";
import { emailDomain, normalizeEmail } from "../lib/email";
import { TABLE_COUNT, VENUE, isValidTable } from "../lib/venue";
import { hmacEmail } from "./crypto";

/**
 * Pure seating-CSV parsing and validation (no I/O). Used by
 * scripts/import-seating.ts; no `server-only` so tsx can import it.
 * Only `HMAC(email) -> table` survives: every other column is discarded.
 */

export class ImportError extends Error {}

export function parseCsv(content: string): { header: string[]; rows: { line: number; cells: string[] }[] } {
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

export function buildSeating(csv: string, allowedDomains: string[], pepper: string): Map<string, number> {
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

export interface Probe {
  email: string;
  table: number;
}

/**
 * Picks up to `count` known attendees (first, evenly spaced, last) to verify a
 * published import end-to-end. Plaintext stays in the importer's memory only.
 * Call after `buildSeating` has validated the same content.
 */
export function sampleProbes(csv: string, count = 3): Probe[] {
  const { header, rows } = parseCsv(csv);
  const emailCol = header.indexOf("email");
  const tableCol = header.indexOf("table");
  if (rows.length === 0 || count < 1) return [];
  const picks = Math.min(count, rows.length);
  const indexes = new Set(
    Array.from({ length: picks }, (_, i) => (picks === 1 ? 0 : Math.round((i * (rows.length - 1)) / (picks - 1)))),
  );
  return [...indexes].map((i) => ({
    email: normalizeEmail(rows[i].cells[emailCol] ?? ""),
    table: Number((rows[i].cells[tableCol] ?? "").trim()),
  }));
}
