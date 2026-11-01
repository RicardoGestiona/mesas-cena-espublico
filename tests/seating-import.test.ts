import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/email";
import { hmacEmail } from "@/server/crypto";
import { ImportError, buildSeating } from "@/server/seating-import";
import { SAMPLE_CSV, TEST_DOMAINS, TEST_PEPPER, csv } from "./helpers";

const build = (content: string) => buildSeating(content, TEST_DOMAINS, TEST_PEPPER);

function expectImportError(content: string, ...fragments: string[]): void {
  try {
    build(content);
    expect.unreachable("import should have failed");
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    for (const fragment of fragments) expect((error as Error).message).toContain(fragment);
  }
}

describe("buildSeating", () => {
  it("keeps only HMAC(email) -> table; no plaintext survives", () => {
    const seating = build(SAMPLE_CSV);
    expect(seating.size).toBe(2);
    expect(seating.get(hmacEmail("lucia.garcia@nexodigital.example", TEST_PEPPER))).toBe(7);
    expect(seating.get(hmacEmail("hugo.perez@atriasistemas.example", TEST_PEPPER))).toBe(42);

    const serialized = JSON.stringify(Object.fromEntries(seating));
    for (const leaked of ["lucia", "garcia", "Nexo", "hugo", "@", "example"]) {
      expect(serialized.toLowerCase()).not.toContain(leaked.toLowerCase());
    }
    for (const key of seating.keys()) expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the same normalization as the lookup (case, spaces)", () => {
    const seating = build(csv("A,B,  Lucia.GARCIA@NexoDigital.example ,X,3"));
    expect(seating.get(hmacEmail(normalizeEmail("lucia.garcia@nexodigital.example"), TEST_PEPPER))).toBe(3);
  });

  it("produces different digests for different peppers", () => {
    const a = [...build(SAMPLE_CSV).keys()];
    const b = [...buildSeating(SAMPLE_CSV, TEST_DOMAINS, `${TEST_PEPPER}-rotated`).keys()];
    expect(a).not.toEqual(b);
  });

  it("accepts a minimal email,table CSV with BOM, CRLF and blank lines", () => {
    const seating = build("﻿email,table\r\na@nexodigital.example,1\r\n\r\nb@nexodigital.example,1\r\n");
    expect(seating.size).toBe(2);
  });

  it("rejects a header without email/table columns", () => {
    expectImportError("name,mesa\nx,1", "header must contain");
  });

  it("rejects quoted fields", () => {
    expectImportError('email,table\n"a@nexodigital.example",1', "line 2: quoted fields");
  });

  it("aborts the whole import listing every invalid line", () => {
    expectImportError(
      csv(
        "A,B,ok@nexodigital.example,X,1",
        "A,B,not-an-email,X,1",
        "A,B,someone@gmail.com,X,1",
        "A,B,t@nexodigital.example,X,51",
        "A,B,t2@nexodigital.example,X,abc",
        "A,B,OK@nexodigital.example,X,2",
      ),
      "line 3: invalid email",
      "line 4: domain not allowed",
      "line 5: table must be 1..50",
      "line 6: table must be 1..50",
      "line 7: duplicate email",
    );
  });

  it("rejects tables over capacity", () => {
    const rows = Array.from({ length: 11 }, (_, i) => `A,B,p${i}@nexodigital.example,X,9`);
    expectImportError(csv(...rows), "table 9: 11 attendees exceed 10 seats");
  });

  it("rejects an empty file", () => {
    expectImportError("email,table\n", "no rows found");
  });

  it("never echoes emails in error messages", () => {
    expectImportError(csv("A,B,secret.person@gmail.com,X,1"));
    try {
      build(csv("A,B,secret.person@gmail.com,X,1"));
    } catch (error) {
      expect((error as Error).message).not.toContain("secret.person");
    }
  });
});
