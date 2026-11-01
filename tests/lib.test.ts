import { describe, expect, it } from "vitest";
import { emailDomain, normalizeEmail } from "@/lib/email";
import { ALL_TABLES, TABLE_COUNT, isValidTable, tablePosition } from "@/lib/venue";

describe("normalizeEmail", () => {
  it.each([
    ["  Lucia.Garcia@NexoDigital.EXAMPLE ", "lucia.garcia@nexodigital.example"],
    ["\tHUGO@atriasistemas.example\n", "hugo@atriasistemas.example"],
    // NFKC folds compatibility forms (fullwidth chars) typed by some mobile keyboards.
    ["ｌｕｃｉａ@nexodigital.example", "lucia@nexodigital.example"],
  ])("normalizes %j", (raw, expected) => {
    expect(normalizeEmail(raw)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeEmail(" Ana.Ruiz@Nexodigital.example ");
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("emailDomain", () => {
  it("uses the last @ and returns empty when absent", () => {
    expect(emailDomain("a@b@nexodigital.example")).toBe("nexodigital.example");
    expect(emailDomain("no-at-sign")).toBe("");
  });
});

describe("venue", () => {
  it("numbers tables row-major from the stage, left to right", () => {
    expect(tablePosition(1)).toEqual({ table: 1, row: 0, col: 0 });
    expect(tablePosition(5)).toEqual({ table: 5, row: 0, col: 4 });
    expect(tablePosition(6)).toEqual({ table: 6, row: 1, col: 0 });
    expect(tablePosition(TABLE_COUNT)).toEqual({ table: TABLE_COUNT, row: 9, col: 4 });
  });

  it("maps every table to a unique grid cell", () => {
    const cells = new Set(ALL_TABLES.map(({ row, col }) => `${row}:${col}`));
    expect(cells.size).toBe(TABLE_COUNT);
  });

  it.each([0, -1, 1.5, TABLE_COUNT + 1, Number.NaN])("rejects table %s", (table) => {
    expect(isValidTable(table)).toBe(false);
  });
});
