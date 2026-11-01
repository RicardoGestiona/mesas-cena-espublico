import { SEATING_HASH_KEY } from "./seating-format";
import { ImportError, type Probe } from "./seating-import";

/**
 * Publishes a seating dataset to the store with end-to-end verification and
 * automatic rollback. Store and verifier are injected (no I/O here) so the
 * orchestration is testable; no `server-only` so the tsx script can import it.
 */

export const STAGING_KEY = `${SEATING_HASH_KEY}:staging`;
export const PREVIOUS_KEY = `${SEATING_HASH_KEY}:previous`;

export interface SeatingStoreAdmin {
  exists(key: string): Promise<boolean>;
  del(key: string): Promise<void>;
  hset(key: string, fields: Record<string, number>): Promise<void>;
  expireAt(key: string, unixSeconds: number): Promise<void>;
  /** Applies all renames in a single atomic transaction (RENAME preserves TTL). */
  atomicRename(pairs: readonly (readonly [from: string, to: string])[]): Promise<void>;
}

export type VerificationResult = { ok: true } | { ok: false; reason: string };
export type Verifier = (probes: readonly Probe[]) => Promise<VerificationResult>;

export interface PublishInput {
  store: SeatingStoreAdmin;
  seating: ReadonlyMap<string, number>;
  expireUnix: number;
  probes: readonly Probe[];
  verify: Verifier;
  chunkSize?: number;
}

export async function publishSeating({
  store,
  seating,
  expireUnix,
  probes,
  verify,
  chunkSize = 200,
}: PublishInput): Promise<void> {
  if (probes.length === 0) throw new ImportError("no probes available to verify the import");

  await store.del(STAGING_KEY);
  const entries = [...seating.entries()];
  for (let i = 0; i < entries.length; i += chunkSize) {
    await store.hset(STAGING_KEY, Object.fromEntries(entries.slice(i, i + chunkSize)));
  }
  // TTL first, so even an abandoned staging key self-deletes after the event.
  await store.expireAt(STAGING_KEY, expireUnix);

  // Swap: readers see either the old or the new full dataset, never a gap.
  const hadPrevious = await store.exists(SEATING_HASH_KEY);
  await store.atomicRename(
    hadPrevious
      ? [
          [SEATING_HASH_KEY, PREVIOUS_KEY],
          [STAGING_KEY, SEATING_HASH_KEY],
        ]
      : [[STAGING_KEY, SEATING_HASH_KEY]],
  );

  let result: VerificationResult;
  try {
    result = await verify(probes);
  } catch {
    result = { ok: false, reason: "verifier threw (network error?)" };
  }

  if (result.ok) {
    // Data minimization: do not keep the superseded dataset around.
    if (hadPrevious) await store.del(PREVIOUS_KEY);
    return;
  }

  if (hadPrevious) await store.atomicRename([[PREVIOUS_KEY, SEATING_HASH_KEY]]);
  else await store.del(SEATING_HASH_KEY);
  throw new ImportError(
    `verification failed, ${hadPrevious ? "previous dataset restored" : "import removed"}: ${result.reason}`,
  );
}
