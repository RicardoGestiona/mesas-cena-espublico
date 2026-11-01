/**
 * Venue layout (draft assumption): rectangular hall, stage at the top,
 * entrance at the bottom, tables of 10 arranged in a portrait grid of rows
 * (portrait so the plan stays legible on phones).
 * Contains no personal data; safe to ship to the client.
 */
export const VENUE = {
  rows: 10,
  tablesPerRow: 5,
  seatsPerTable: 10,
} as const;

export const TABLE_COUNT = VENUE.rows * VENUE.tablesPerRow;
export const TOTAL_SEATS = TABLE_COUNT * VENUE.seatsPerTable;

export interface TablePosition {
  table: number;
  row: number; // 0 = closest to stage
  col: number; // 0 = left when facing the stage
}

/** Tables are numbered row-major starting at 1 next to the stage, left to right. */
export function tablePosition(table: number): TablePosition {
  const index = table - 1;
  return {
    table,
    row: Math.floor(index / VENUE.tablesPerRow),
    col: index % VENUE.tablesPerRow,
  };
}

export function isValidTable(table: number): boolean {
  return Number.isInteger(table) && table >= 1 && table <= TABLE_COUNT;
}

export const ALL_TABLES: readonly TablePosition[] = Array.from(
  { length: TABLE_COUNT },
  (_, i) => tablePosition(i + 1),
);
