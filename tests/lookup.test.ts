import { describe, expect, it, vi } from "vitest";
import { hmacEmail } from "@/server/crypto";
import { lookupTable, type LookupDeps } from "@/server/lookup";
import type { SeatingRepository } from "@/server/seating-repository";
import { TEST_DOMAINS, TEST_PEPPER } from "./helpers";

function deps(seating: Record<string, number>): LookupDeps & { findTable: ReturnType<typeof vi.fn> } {
  const findTable = vi.fn<SeatingRepository["findTable"]>(async (digest) => seating[digest] ?? null);
  return {
    env: { EMAIL_HMAC_PEPPER: TEST_PEPPER, ALLOWED_EMAIL_DOMAINS: TEST_DOMAINS },
    repository: { findTable },
    findTable,
  };
}

const LUCIA = "lucia.garcia@nexodigital.example";
const seating = { [hmacEmail(LUCIA, TEST_PEPPER)]: 7 };

describe("lookupTable", () => {
  it("returns the table for a known email, regardless of case and spaces", async () => {
    expect(await lookupTable(LUCIA, deps(seating))).toEqual({ status: "found", table: 7 });
    expect(await lookupTable("  LUCIA.Garcia@NexoDigital.example ", deps(seating))).toEqual({
      status: "found",
      table: 7,
    });
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
      expect(d.findTable).toHaveBeenCalledTimes(1);
      expect(d.findTable.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("never resolves an ineligible email even if its digest were stored", async () => {
    // Defense in depth: a foreign-domain row smuggled into the store must not match.
    const foreign = "intruso@gmail.com";
    const poisoned = { [hmacEmail(foreign, TEST_PEPPER)]: 3, [hmacEmail(`ineligible:${foreign}`, TEST_PEPPER)]: 3 };
    expect(await lookupTable(foreign, deps(poisoned))).toEqual({ status: "not_found" });
  });

  it("treats an out-of-range stored table as not_found", async () => {
    const corrupt = { [hmacEmail(LUCIA, TEST_PEPPER)]: 999 };
    expect(await lookupTable(LUCIA, deps(corrupt))).toEqual({ status: "not_found" });
  });
});
