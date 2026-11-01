import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { serverEnv } from "./env";

export interface RateLimiter {
  /** Returns true if the request identified by `key` is allowed. */
  allow(key: string): Promise<boolean>;
}

class UpstashRateLimiter implements RateLimiter {
  private readonly limiter: Ratelimit;

  constructor(perMinute: number) {
    this.limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(perMinute, "1 m"),
      prefix: "rl:lookup",
    });
  }

  async allow(key: string): Promise<boolean> {
    const { success } = await this.limiter.limit(key);
    return success;
  }
}

/** Local development only: fixed window per process. */
class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly perMinute: number) {}

  async allow(key: string): Promise<boolean> {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.perMinute;
  }
}

let limiter: RateLimiter | undefined;

export function rateLimiter(): RateLimiter {
  if (!limiter) {
    const env = serverEnv();
    limiter =
      env.SEATING_STORE === "redis"
        ? new UpstashRateLimiter(env.RATE_LIMIT_PER_MINUTE)
        : new MemoryRateLimiter(env.RATE_LIMIT_PER_MINUTE);
  }
  return limiter;
}
