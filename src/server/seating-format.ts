import { z } from "zod";

/**
 * Storage contract shared by the import script (Node/tsx) and the runtime
 * repository. Kept free of `server-only` so scripts can import it.
 */

/** Redis hash holding `{ email_hmac -> table }`. Swapped atomically on import. */
export const SEATING_HASH_KEY = "seating";

export const TableValue = z.coerce.number().int().positive();

export const HashedSeatingFileSchema = z.record(z.string().regex(/^[0-9a-f]{64}$/), TableValue);
