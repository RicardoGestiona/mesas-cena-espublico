import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";
import { serverEnv } from "./env";
import { HashedSeatingFileSchema, SEATING_HASH_KEY, TableValue } from "./seating-format";

export interface SeatingRepository {
  findTable(emailHmac: string): Promise<number | null>;
}

class RedisSeatingRepository implements SeatingRepository {
  constructor(private readonly redis: Redis) {}

  async findTable(emailHmac: string): Promise<number | null> {
    const value = await this.redis.hget<string | number>(SEATING_HASH_KEY, emailHmac);
    if (value === null || value === undefined) return null;
    const parsed = TableValue.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
}

/** Local development only: reads the hashed file produced by `npm run seating:import`. */
class MemorySeatingRepository implements SeatingRepository {
  private data: Promise<Record<string, number>> | undefined;

  constructor(private readonly filePath: string) {}

  private load(): Promise<Record<string, number>> {
    this.data ??= readFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), this.filePath), "utf8").then((raw) =>
      HashedSeatingFileSchema.parse(JSON.parse(raw)),
    );
    return this.data;
  }

  async findTable(emailHmac: string): Promise<number | null> {
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
        ? new RedisSeatingRepository(Redis.fromEnv())
        : new MemorySeatingRepository(env.SEATING_MEMORY_FILE);
  }
  return repository;
}
