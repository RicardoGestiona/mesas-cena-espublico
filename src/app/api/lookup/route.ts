import { randomUUID } from "node:crypto";
import { logger } from "@/server/logger";
import { LookupRequestSchema, lookupTable, type LookupResult } from "@/server/lookup";
import { rateLimiter } from "@/server/rate-limit";

/** Uniform minimum latency so response time leaks nothing about the lookup outcome. */
const MIN_RESPONSE_MS = 250;
const MAX_BODY_BYTES = 1024;

type ApiBody = LookupResult | { status: "rate_limited" } | { status: "error" };

function clientKey(request: Request): string {
  // On Vercel, x-forwarded-for is set by the platform; first entry is the client.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function respond(startedAt: number, body: ApiBody, status: number): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
  }
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = randomUUID();

  try {
    if (!(await rateLimiter().allow(clientKey(request)))) {
      logger.warn("lookup.rate_limited", { requestId });
      return respond(startedAt, { status: "rate_limited" }, 429);
    }

    const raw = await request.text();
    let json: unknown = null;
    if (raw.length <= MAX_BODY_BYTES) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }
    const parsed = LookupRequestSchema.safeParse(json);
    const result = await lookupTable(parsed.success ? parsed.data.email : "");

    logger.info("lookup.completed", {
      requestId,
      outcome: result.status,
      durationMs: Date.now() - startedAt,
    });
    return respond(startedAt, result, 200);
  } catch (error) {
    logger.error("lookup.failed", {
      requestId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return respond(startedAt, { status: "error" }, 500);
  }
}
