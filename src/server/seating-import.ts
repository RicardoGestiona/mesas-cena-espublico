import { z } from "zod";
import { emailDomain, normalizeEmail } from "../lib/email";
import { TABLE_COUNT, VENUE, isValidTable } from "../lib/venue";
import { hmacEmail } from "./crypto";
import { MAX_COMPANY_LENGTH, MAX_NAME_LENGTH, type SeatEntry, type Tablemate } from "./seating-format";

/**
 * Pure seating-CSV parsing and validation (no I/O). Used by
 * scripts/import-seating.ts; no `server-only` so tsx can import it.
 * Output: `HMAC(email) -> { table, tablemates }`. Emails never survive; names
 * and companies are kept only as tablemates of other attendees.
 */

export class ImportError extends Error {}

export const REQUIRED_COLUMNS = ["email", "table", "first_name", "last_name", "company"] as const;
type Column = (typeof REQUIRED_COLUMNS)[number];

type Delimiter = "," | ";";

/** U+FFFD appears when a non-UTF-8 file (e.g. Excel "CSV (delimitado por comas)", Windows-1252) is decoded as UTF-8. */
const REPLACEMENT_CHAR = "�";

/**
 * Splits one CSV line (RFC 4180 quoting: `"a, b"`, `""` = literal quote; whitespace
 * around a quoted value is allowed). Quoted values cannot span lines.
 */
function splitLine(raw: string, delimiter: Delimiter, line: number): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quotedCell = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (inQuotes) {
      if (char !== '"') cell += char;
      else if (raw[i + 1] === '"') cell += raw[++i];
      else inQuotes = false;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
      quotedCell = false;
    } else if (char === '"' && !quotedCell && cell.trim() === "") {
      inQuotes = true;
      quotedCell = true;
      cell = "";
    } else {
      cell += char;
    }
  }
  if (inQuotes) throw new ImportError(`line ${line}: unterminated quoted field`);
  cells.push(cell);
  return cells;
}

const headerCells = (raw: string, delimiter: Delimiter) =>
  splitLine(raw, delimiter, 1).map((h) => h.trim().toLowerCase());

/**
 * The delimiter that yields the most required columns, so a header with a renamed
 * column still reports only that column as missing. Ties fall back to ",".
 */
function detectDelimiter(rawHeader: string): Delimiter {
  const found = (d: Delimiter) => REQUIRED_COLUMNS.filter((c) => headerCells(rawHeader, d).includes(c)).length;
  return found(";") > found(",") ? ";" : ",";
}

/**
 * Parses the seating CSV as exported by Excel: UTF-8 (BOM allowed), `,` or `;`
 * (detected from the header), RFC 4180 quotes, CRLF, blank or all-empty rows skipped.
 * Errors name the line, never the value.
 */
export function parseCsv(content: string): { header: string[]; rows: { line: number; cells: string[] }[] } {
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (raw.includes(REPLACEMENT_CHAR)) throw new ImportError(`line ${i + 1}: not valid UTF-8 (save as "CSV UTF-8")`);
  });
  const delimiter = detectDelimiter(lines[0] ?? "");
  const header = headerCells(lines[0] ?? "", delimiter);
  const rows: { line: number; cells: string[] }[] = [];
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2;
    const cells = splitLine(raw, delimiter, line);
    if (cells.every((cell) => cell.trim() === "")) return;
    rows.push({ line, cells });
  });
  return { header, rows };
}

function columnIndexes(header: string[]): Record<Column, number> {
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new ImportError(`header must contain: ${REQUIRED_COLUMNS.join(", ")} (missing: ${missing.join(", ")})`);
  }
  return Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<Column, number>;
}

// Control and format characters (incl. bidi overrides used for display spoofing).
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}]/u;

/** Normalized display text, or an error label. Never echoes the value. */
function cleanText(raw: string | undefined, field: string, max: number): string | { error: string } {
  const value = (raw ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (value === "") return { error: `${field} is empty` };
  if (UNSAFE_CHARS.test(value)) return { error: `${field} contains control characters` };
  if (value.length > max) return { error: `${field} exceeds ${max} chars` };
  return value;
}

interface Attendee {
  digest: string;
  table: number;
  mate: Tablemate;
}

const byName = (a: Tablemate, b: Tablemate) =>
  a.name.localeCompare(b.name, "es") || a.company.localeCompare(b.company, "es");

export interface SeatingValidation {
  /** Empty when `errors` is not. */
  seating: Map<string, SeatEntry>;
  /** Line/field/rule messages; never contain values. */
  errors: string[];
}

/**
 * Validates the whole CSV and collects every error instead of throwing (used by
 * `--dry-run` to hand the full list back to HR). Format and header errors abort
 * parsing, so they are reported alone.
 */
export function validateSeating(csv: string, allowedDomains: string[], pepper: string): SeatingValidation {
  try {
    return collectSeating(csv, allowedDomains, pepper);
  } catch (error) {
    if (error instanceof ImportError) return { seating: new Map(), errors: [error.message] };
    throw error;
  }
}

/** All-or-nothing: throws an `ImportError` listing every validation error. */
export function buildSeating(csv: string, allowedDomains: string[], pepper: string): Map<string, SeatEntry> {
  const { seating, errors } = collectSeating(csv, allowedDomains, pepper);
  if (errors.length > 0) throw new ImportError(`${errors.length} validation error(s):\n  ${errors.join("\n  ")}`);
  return seating;
}

function collectSeating(csv: string, allowedDomains: string[], pepper: string): SeatingValidation {
  const { header, rows } = parseCsv(csv);
  const col = columnIndexes(header);

  const errors: string[] = [];
  const attendees: Attendee[] = [];
  const seen = new Set<string>();

  for (const { line, cells } of rows) {
    const email = normalizeEmail(cells[col.email] ?? "");
    const table = Number((cells[col.table] ?? "").trim());
    if (!z.email().safeParse(email).success) errors.push(`line ${line}: invalid email`);
    else if (!allowedDomains.includes(emailDomain(email))) errors.push(`line ${line}: domain not allowed`);
    if (!isValidTable(table)) errors.push(`line ${line}: table must be 1..${TABLE_COUNT}`);

    const firstName = cleanText(cells[col.first_name], "first_name", MAX_NAME_LENGTH);
    const lastName = cleanText(cells[col.last_name], "last_name", MAX_NAME_LENGTH);
    const company = cleanText(cells[col.company], "company", MAX_COMPANY_LENGTH);
    for (const field of [firstName, lastName, company]) {
      if (typeof field !== "string") errors.push(`line ${line}: ${field.error}`);
    }

    const digest = hmacEmail(email, pepper);
    if (seen.has(digest)) errors.push(`line ${line}: duplicate email`);
    seen.add(digest);

    if (typeof firstName === "string" && typeof lastName === "string" && typeof company === "string") {
      const name = `${firstName} ${lastName}`;
      if (name.length > MAX_NAME_LENGTH) errors.push(`line ${line}: full name exceeds ${MAX_NAME_LENGTH} chars`);
      attendees.push({ digest, table, mate: { name, company } });
    }
  }

  const byTable = new Map<number, Attendee[]>();
  for (const attendee of attendees) byTable.set(attendee.table, [...(byTable.get(attendee.table) ?? []), attendee]);
  for (const [table, members] of byTable) {
    if (members.length > VENUE.seatsPerTable) {
      errors.push(`table ${table}: ${members.length} attendees exceed ${VENUE.seatsPerTable} seats`);
    }
  }
  if (rows.length === 0) errors.push("no rows found");
  if (errors.length > 0) return { seating: new Map(), errors };

  const seating = new Map<string, SeatEntry>();
  for (const { digest, table } of attendees) {
    const tablemates = byTable
      .get(table)!
      .filter((other) => other.digest !== digest)
      .map((other) => other.mate)
      .sort(byName);
    seating.set(digest, { table, tablemates });
  }
  return { seating, errors };
}

export interface Probe {
  email: string;
  table: number;
  /** Expected number of tablemates (occupancy - 1). */
  tablemates: number;
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

  const tableOf = (i: number) => Number((rows[i].cells[tableCol] ?? "").trim());
  const occupancy = new Map<number, number>();
  rows.forEach((_, i) => occupancy.set(tableOf(i), (occupancy.get(tableOf(i)) ?? 0) + 1));

  const picks = Math.min(count, rows.length);
  const indexes = new Set(
    Array.from({ length: picks }, (_, i) => (picks === 1 ? 0 : Math.round((i * (rows.length - 1)) / (picks - 1)))),
  );
  return [...indexes].map((i) => ({
    email: normalizeEmail(rows[i].cells[emailCol] ?? ""),
    table: tableOf(i),
    tablemates: occupancy.get(tableOf(i))! - 1,
  }));
}
