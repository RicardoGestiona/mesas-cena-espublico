import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/email";
import { hmacEmail } from "@/server/crypto";
import { ImportError, buildSeating, sampleProbes } from "@/server/seating-import";
import { SAMPLE_CSV, TEST_DOMAINS, TEST_PEPPER, csv } from "./helpers";

const build = (content: string) => buildSeating(content, TEST_DOMAINS, TEST_PEPPER);
const digest = (email: string) => hmacEmail(normalizeEmail(email), TEST_PEPPER);

function expectImportError(content: string, ...fragments: string[]): string {
  try {
    build(content);
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    for (const fragment of fragments) expect((error as Error).message).toContain(fragment);
    return (error as Error).message;
  }
  return expect.unreachable("import should have failed");
}

const TABLE_7 = csv(
  "Lucía,García López,lucia.garcia@nexodigital.example,Nexo Digital,7",
  "Hugo,Pérez Ruiz,hugo.perez@atriasistemas.example,Atria Sistemas,7",
  "Ana,Martín Gil,ana.martin@nexodigital.example,Nexo Digital,7",
  "Leo,Sanz Vega,leo.sanz@atriasistemas.example,Atria Sistemas,42",
);

describe("buildSeating", () => {
  it("keys records by HMAC(email) and never stores emails or domains", () => {
    const seating = build(SAMPLE_CSV);
    expect(seating.size).toBe(2);
    for (const key of seating.keys()) expect(key).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(Object.fromEntries(seating)).toLowerCase();
    for (const leaked of ["@", ".example", "lucia.garcia", "hugo.perez"]) expect(serialized).not.toContain(leaked);
  });

  it("lists tablemates (name + company) excluding the attendee themself, sorted by name", () => {
    const seating = build(TABLE_7);
    expect(seating.get(digest("lucia.garcia@nexodigital.example"))).toEqual({
      table: 7,
      tablemates: [
        { name: "Ana Martín Gil", company: "Nexo Digital" },
        { name: "Hugo Pérez Ruiz", company: "Atria Sistemas" },
      ],
    });
    expect(seating.get(digest("leo.sanz@atriasistemas.example"))).toEqual({ table: 42, tablemates: [] });
  });

  it("never leaks attendees of other tables", () => {
    const entry = build(TABLE_7).get(digest("hugo.perez@atriasistemas.example"))!;
    expect(entry.tablemates.map((m) => m.name)).not.toContain("Leo Sanz Vega");
    expect(entry.tablemates.map((m) => m.name)).not.toContain("Hugo Pérez Ruiz");
  });

  it("uses the same email normalization as the lookup", () => {
    const seating = build(csv("Ana,Ruiz,  Lucia.GARCIA@NexoDigital.example ,Nexo Digital,3"));
    expect(seating.get(digest("lucia.garcia@nexodigital.example"))?.table).toBe(3);
  });

  it("normalizes display text (NFC, trims, collapses spaces)", () => {
    const seating = build(csv("  Lucía ,  García   López ,a@nexodigital.example,  Nexo   Digital ,1", "B,C,b@nexodigital.example,X,1"));
    expect(seating.get(digest("b@nexodigital.example"))?.tablemates).toEqual([
      { name: "Lucía García López", company: "Nexo Digital" },
    ]);
  });

  it("produces different keys for different peppers", () => {
    const a = [...build(SAMPLE_CSV).keys()];
    const b = [...buildSeating(SAMPLE_CSV, TEST_DOMAINS, `${TEST_PEPPER}-rotated`).keys()];
    expect(a).not.toEqual(b);
  });

  it("accepts BOM, CRLF and blank lines", () => {
    const content = "﻿first_name,last_name,email,company,table\r\nA,B,a@nexodigital.example,X,1\r\n\r\nC,D,b@nexodigital.example,Y,1\r\n";
    expect(build(content).size).toBe(2);
  });

  it("requires every column and names the missing ones", () => {
    expectImportError("email,table\na@nexodigital.example,1", "missing: first_name, last_name, company");
  });

  it("rejects quoted fields", () => {
    expectImportError('first_name,last_name,email,company,table\nA,B,"a@nexodigital.example",X,1', "line 2: quoted fields");
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
        ",B,e1@nexodigital.example,X,3",
        "A,,e2@nexodigital.example,X,3",
        "A,B,e3@nexodigital.example,,3",
      ),
      "line 3: invalid email",
      "line 4: domain not allowed",
      "line 5: table must be 1..50",
      "line 6: table must be 1..50",
      "line 7: duplicate email",
      "line 8: first_name is empty",
      "line 9: last_name is empty",
      "line 10: company is empty",
    );
  });

  it("rejects control/bidi characters and over-long values", () => {
    expectImportError(
      csv(`A‮evil,B,a@nexodigital.example,X,1`, `A,${"x".repeat(121)},b@nexodigital.example,X,1`),
      "line 2: first_name contains control characters",
      "line 3: last_name exceeds 120 chars",
    );
  });

  it("rejects tables over capacity", () => {
    const rows = Array.from({ length: 11 }, (_, i) => `A,B,p${i}@nexodigital.example,X,9`);
    expectImportError(csv(...rows), "table 9: 11 attendees exceed 10 seats");
  });

  it("rejects an empty file", () => {
    expectImportError("first_name,last_name,email,company,table\n", "no rows found");
  });

  it("never echoes emails or names in error messages", () => {
    const message = expectImportError(csv("Secreta,Persona,secret.person@gmail.com,X,1", `Nombre\u0007Raro,B,c@nexodigital.example,X,1`));
    for (const leaked of ["secret.person", "Secreta", "Persona", "Nombre"]) expect(message).not.toContain(leaked);
  });
});

describe("sampleProbes", () => {
  it("includes the expected tablemate count for each probe", () => {
    expect(sampleProbes(TABLE_7)).toEqual([
      { email: "lucia.garcia@nexodigital.example", table: 7, tablemates: 2 },
      { email: "ana.martin@nexodigital.example", table: 7, tablemates: 2 },
      { email: "leo.sanz@atriasistemas.example", table: 42, tablemates: 0 },
    ]);
  });
});
