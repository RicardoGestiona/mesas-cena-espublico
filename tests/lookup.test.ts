import { describe, expect, it, vi } from "vitest";
import { hmacEmail } from "@/server/crypto";
import { lookupTable, type LookupDeps } from "@/server/lookup";
import type { SeatEntry } from "@/server/seating-format";
import type { SeatingRepository } from "@/server/seating-repository";
import { TEST_DOMAINS, TEST_PEPPER } from "./helpers";

function deps(seating: Record<string, SeatEntry>): LookupDeps & { findSeat: ReturnType<typeof vi.fn> } {
  const findSeat = vi.fn<SeatingRepository["findSeat"]>(async (digest) => seating[digest] ?? null);
  return {
    env: { EMAIL_HMAC_PEPPER: TEST_PEPPER, ALLOWED_EMAIL_DOMAINS: TEST_DOMAINS },
    repository: { findSeat },
    findSeat,
  };
}

const MATES = [
  { name: "Ana Martín Gil", company: "Nexo Digital" },
  { name: "Hugo Pérez Ruiz", company: "Atria Sistemas" },
];
const seat = (table: number, tablemates = MATES): SeatEntry => ({ table, tablemates });

const LUCIA = "lucia.garcia@nexodigital.example";
const seating = { [hmacEmail(LUCIA, TEST_PEPPER)]: seat(7) };

describe("lookupTable", () => {
  it("returns the table for a known email, regardless of case and spaces", async () => {
    const expected = { status: "found", table: 7, tablemates: MATES };
    expect(await lookupTable(LUCIA, deps(seating))).toStrictEqual(expected);
    expect(await lookupTable("  LUCIA.Garcia@NexoDigital.example ", deps(seating))).toStrictEqual(expected);
  });

  it.each([
    ["unknown email", "nadie@nexodigital.example"],
    ["disallowed domain", "lucia.garcia@gmail.com"],
    ["invalid format", "lucia.garcia"],
    ["empty string", ""],
  ])("collapses %s into the same not_found", async (_, email) => {
    expect(await lookupTable(email, deps(seating))).toEqual({ status: "not_found" });
  });

  it("performs exactly one store read on every path (no timing oracle)", async () => {
    for (const email of [LUCIA, "nadie@nexodigital.example", "x@gmail.com", "garbage"]) {
      const d = deps(seating);
      await lookupTable(email, d);
      expect(d.findSeat).toHaveBeenCalledTimes(1);
      expect(d.findSeat.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("never resolves an ineligible email even if its digest were stored", async () => {
    // Defense in depth: a foreign-domain row smuggled into the store must not match.
    const foreign = "intruso@gmail.com";
    const poisoned = {
      [hmacEmail(foreign, TEST_PEPPER)]: seat(3),
      [hmacEmail(`ineligible:${foreign}`, TEST_PEPPER)]: seat(3),
    };
    expect(await lookupTable(foreign, deps(poisoned))).toEqual({ status: "not_found" });
  });

  it("treats an out-of-range stored table as not_found", async () => {
    const corrupt = { [hmacEmail(LUCIA, TEST_PEPPER)]: seat(999) };
    expect(await lookupTable(LUCIA, deps(corrupt))).toEqual({ status: "not_found" });
  });

  it("projects tablemates to name + company only, even if the store holds extra fields", async () => {
    const tainted = {
      table: 7,
      tablemates: [{ name: "Ana", company: "Nexo", email: "ana@nexodigital.example", id: "f".repeat(64) }],
    } as unknown as SeatEntry;
    const result = await lookupTable(LUCIA, deps({ [hmacEmail(LUCIA, TEST_PEPPER)]: tainted }));
    expect(result).toStrictEqual({ status: "found", table: 7, tablemates: [{ name: "Ana", company: "Nexo" }] });
  });
});
