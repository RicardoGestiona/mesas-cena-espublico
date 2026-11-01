import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSeating } from "@/server/seating-import";

export const TEST_PEPPER = "test-pepper-0123456789abcdefghijklmnopqrstuvwxyz";
export const TEST_DOMAINS = ["nexodigital.example", "atriasistemas.example"];

export function csv(...rows: string[]): string {
  return ["first_name,last_name,email,company,table", ...rows].join("\n");
}

export const SAMPLE_CSV = csv(
  "Lucía,García López,lucia.garcia@nexodigital.example,Nexo Digital,7",
  "Hugo,Pérez Ruiz,hugo.perez@atriasistemas.example,Atria Sistemas,42",
);

/** Writes a hashed seating file (as the import script would) and returns its absolute path. */
export function writeHashedSeating(content: string = SAMPLE_CSV): string {
  const seating = buildSeating(content, TEST_DOMAINS, TEST_PEPPER);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "mesas-cena-")), "seating.hashed.json");
  writeFileSync(file, JSON.stringify(Object.fromEntries(seating)), "utf8");
  return file;
}
