import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { redisClient, serverEnv } from "./env";
import { logger } from "./logger";
import { HashedSeatingFileSchema, SEATING_HASH_KEY, StoredSeatEntrySchema, type SeatEntry } from "./seating-format";

export interface SeatingRepository {
  /** Single store read. Returns null when unknown or when the stored record is corrupt. */
  findSeat(emailHmac: string): Promise<SeatEntry | null>;
}

class RedisSeatingRepository implements SeatingRepository {
  constructor(private readonly redis: Redis) {}

  async findSeat(emailHmac: string): Promise<SeatEntry | null> {
    const value = await this.redis.hget<unknown>(SEATING_HASH_KEY, emailHmac);
    if (value === null || value === undefined) return null;
    const parsed = StoredSeatEntrySchema.safeParse(value);
    if (!parsed.success) {
      logger.error("seating.corrupt_record");
      return null;
    }
    return parsed.data;
  }
}

/** Local development only: reads the hashed file produced by `npm run seating:import`. */
class MemorySeatingRepository implements SeatingRepository {
  private data: Promise<Record<string, SeatEntry>> | undefined;

  constructor(private readonly filePath: string) {}

  private load(): Promise<Record<string, SeatEntry>> {
    this.data ??= readFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), this.filePath), "utf8").then((raw) =>
      HashedSeatingFileSchema.parse(JSON.parse(raw)),
    );
    return this.data;
  }

  async findSeat(emailHmac: string): Promise<SeatEntry | null> {
    const data = await this.load();
    return Object.hasOwn(data, emailHmac) ? data[emailHmac] : null;
  }
}

let repository: SeatingRepository | undefined;

export function seatingRepository(): SeatingRepository {
  if (!repository) {
    const env = serverEnv();
    repository =
      env.SEATING_STORE === "redis"
        ? new RedisSeatingRepository(redisClient(env))
        : new MemorySeatingRepository(env.SEATING_MEMORY_FILE);
  }
  return repository;
}
