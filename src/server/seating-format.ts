import { z } from "zod";
import { VENUE } from "../lib/venue";

/**
 * Storage contract shared by the import script (Node/tsx) and the runtime
 * repository. Kept free of `server-only` so scripts can import it.
 *
 * One record per attendee, keyed by HMAC(email): `{ table, tablemates }`,
 * precomputed at import time and excluding the attendee themself, so a lookup
 * is always a single store read. Emails are never stored.
 */

/**
 * Redis hash holding `{ email_hmac -> JSON(SeatEntry) }`. Swapped atomically on import.
 * Must match the `mesas-seating-reader` ACL key pattern (~seating).
 */
export const SEATING_HASH_KEY = "seating";

export const MAX_NAME_LENGTH = 120;
export const MAX_COMPANY_LENGTH = 120;

export const TableValue = z.coerce.number().int().positive();

export const TablemateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  company: z.string().min(1).max(MAX_COMPANY_LENGTH),
});
export type Tablemate = z.infer<typeof TablemateSchema>;

export const SeatEntrySchema = z.object({
  table: TableValue,
  tablemates: z.array(TablemateSchema).max(VENUE.seatsPerTable - 1),
});
export type SeatEntry = z.infer<typeof SeatEntrySchema>;

/**
 * Stored representation: a SeatEntry object (Upstash auto-deserializes JSON),
 * its JSON string, or a legacy bare table number from pre-tablemates imports
 * (served with no tablemates until the next import).
 */
export const StoredSeatEntrySchema = z.union([
  TableValue.transform((table): SeatEntry => ({ table, tablemates: [] })),
  SeatEntrySchema,
  z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "invalid JSON" });
        return z.NEVER;
      }
    })
    .pipe(SeatEntrySchema),
]);

export const HashedSeatingFileSchema = z.record(z.string().regex(/^[0-9a-f]{64}$/), StoredSeatEntrySchema);
