import { describe, expect, it, vi } from "vitest";
import { SEATING_HASH_KEY } from "@/server/seating-format";
import { ImportError, sampleProbes, type Probe } from "@/server/seating-import";
import {
  PREVIOUS_KEY,
  STAGING_KEY,
  publishSeating,
  type SeatingStoreAdmin,
  type Verifier,
} from "@/server/seating-publish";
import { csv } from "./helpers";

/** In-memory Redis subset with real semantics: RENAME overwrites, fails on missing source, keeps TTL. */
class FakeRedis implements SeatingStoreAdmin {
  readonly hashes = new Map<string, Map<string, number>>();
  readonly ttl = new Map<string, number>();
  /** Snapshots of the live key after every mutation, to prove it is never missing mid-swap. */
  readonly liveHistory: (number | null)[] = [];

  private record(): void {
    this.liveHistory.push(this.hashes.get(SEATING_HASH_KEY)?.size ?? null);
  }

  async exists(key: string) {
    return this.hashes.has(key);
  }
  async del(key: string) {
    this.hashes.delete(key);
    this.ttl.delete(key);
    this.record();
  }
  async hset(key: string, fields: Record<string, number>) {
    const hash = this.hashes.get(key) ?? new Map<string, number>();
    for (const [field, value] of Object.entries(fields)) hash.set(field, value);
    this.hashes.set(key, hash);
  }
  async expireAt(key: string, unixSeconds: number) {
    this.ttl.set(key, unixSeconds);
  }
  async atomicRename(pairs: readonly (readonly [string, string])[]) {
    for (const [from] of pairs) if (!this.hashes.has(from)) throw new Error(`ERR no such key ${from}`);
    for (const [from, to] of pairs) {
      this.hashes.set(to, this.hashes.get(from)!);
      this.hashes.delete(from);
      const ttl = this.ttl.get(from);
      this.ttl.delete(from);
      if (ttl === undefined) this.ttl.delete(to);
      else this.ttl.set(to, ttl);
    }
    this.record();
  }
}

const EXPIRE = 2_000_000_000;
const PROBES: Probe[] = [{ email: "a@nexodigital.example", table: 1 }];
const NEW = new Map(Array.from({ length: 450 }, (_, i) => [`${i}`.padStart(64, "0"), (i % 50) + 1] as const));
const ok: Verifier = async () => ({ ok: true });
const fail: Verifier = async () => ({ ok: false, reason: "probe 1/1: not_found (pepper)" });

function storeWithPrevious(): FakeRedis {
  const store = new FakeRedis();
  store.hashes.set(SEATING_HASH_KEY, new Map([["old".padStart(64, "f"), 9]]));
  store.ttl.set(SEATING_HASH_KEY, EXPIRE - 100);
  return store;
}

const publish = (store: FakeRedis, verify: Verifier) =>
  publishSeating({ store, seating: NEW, expireUnix: EXPIRE, probes: PROBES, verify, chunkSize: 200 });

describe("publishSeating", () => {
  it("first import: publishes with TTL and leaves no staging/previous keys", async () => {
    const store = new FakeRedis();
    await publish(store, ok);
    expect(store.hashes.get(SEATING_HASH_KEY)?.size).toBe(450);
    expect(store.ttl.get(SEATING_HASH_KEY)).toBe(EXPIRE);
    expect([...store.hashes.keys()]).toEqual([SEATING_HASH_KEY]);
  });

  it("re-import: replaces atomically (live key never missing) and drops the old dataset", async () => {
    const store = storeWithPrevious();
    await publish(store, ok);
    expect(store.hashes.get(SEATING_HASH_KEY)?.size).toBe(450);
    expect(store.ttl.get(SEATING_HASH_KEY)).toBe(EXPIRE);
    expect(store.hashes.has(PREVIOUS_KEY)).toBe(false);
    expect(store.hashes.has(STAGING_KEY)).toBe(false);
    expect(store.liveHistory).not.toContain(null);
  });

  it("verification failure on re-import restores the previous dataset with its TTL", async () => {
    const store = storeWithPrevious();
    await expect(publish(store, fail)).rejects.toThrow(/previous dataset restored: probe 1\/1: not_found/);
    expect([...store.hashes.get(SEATING_HASH_KEY)!.values()]).toEqual([9]);
    expect(store.ttl.get(SEATING_HASH_KEY)).toBe(EXPIRE - 100);
    expect([...store.hashes.keys()]).toEqual([SEATING_HASH_KEY]);
    expect(store.liveHistory).not.toContain(null);
  });

  it("verification failure on first import removes the unverified data", async () => {
    const store = new FakeRedis();
    await expect(publish(store, fail)).rejects.toThrow(/import removed/);
    expect(store.hashes.size).toBe(0);
  });

  it("treats a throwing verifier (network down) as failure and rolls back", async () => {
    const store = storeWithPrevious();
    const throwing: Verifier = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(publish(store, throwing)).rejects.toBeInstanceOf(ImportError);
    expect([...store.hashes.get(SEATING_HASH_KEY)!.values()]).toEqual([9]);
  });

  it("refuses to publish without probes, touching nothing", async () => {
    const store = storeWithPrevious();
    const hset = vi.spyOn(store, "hset");
    await expect(
      publishSeating({ store, seating: NEW, expireUnix: EXPIRE, probes: [], verify: ok }),
    ).rejects.toThrow(/no probes/);
    expect(hset).not.toHaveBeenCalled();
  });

  it("sets the TTL on staging before swapping, so leftovers self-delete", async () => {
    const store = new FakeRedis();
    const order: string[] = [];
    vi.spyOn(store, "expireAt").mockImplementation(async (key, unix) => {
      order.push(`expire:${key}`);
      store.ttl.set(key, unix);
    });
    const rename = store.atomicRename.bind(store);
    vi.spyOn(store, "atomicRename").mockImplementation(async (pairs) => {
      order.push("rename");
      await rename(pairs);
    });
    await publish(store, ok);
    expect(order).toEqual([`expire:${STAGING_KEY}`, "rename"]);
  });
});

describe("sampleProbes", () => {
  const rows = Array.from({ length: 10 }, (_, i) => `A,B,P${i}@NexoDigital.example,X,${i + 1}`);

  it("picks first, middle and last attendees, normalized", () => {
    expect(sampleProbes(csv(...rows))).toEqual([
      { email: "p0@nexodigital.example", table: 1 },
      { email: "p5@nexodigital.example", table: 6 },
      { email: "p9@nexodigital.example", table: 10 },
    ]);
  });

  it("handles files smaller than the requested count", () => {
    expect(sampleProbes(csv(rows[0]))).toEqual([{ email: "p0@nexodigital.example", table: 1 }]);
    expect(sampleProbes(csv(rows[0], rows[1]), 3)).toHaveLength(2);
    expect(sampleProbes("email,table\n")).toEqual([]);
  });
});
