import { randomUUID } from "node:crypto";
import { ConfigError } from "@/server/env";
import { logger } from "@/server/logger";
import { LookupRequestSchema, lookupTable, type LookupResult } from "@/server/lookup";
import { rateLimiter } from "@/server/rate-limit";

/** Uniform minimum latency so response time leaks nothing about the lookup outcome. */
const MIN_RESPONSE_MS = 250;
const MAX_BODY_BYTES = 1024;

type ApiBody = LookupResult | { status: "rate_limited" } | { status: "error" };

/**
 * Only same-origin JSON calls are processed. A cross-site page cannot send
 * `application/json` without a CORS preflight (which fails: no ACAO), and
 * `Sec-Fetch-Site` rejects cross-site browser requests explicitly. Checked
 * BEFORE the rate limiter so third-party pages opened on the venue wifi cannot
 * burn the shared NAT IP's budget. Independent of the email: no oracle.
 * Non-browser clients (import verifier) send no Sec-Fetch-Site and pass.
 */
function rejectionReason(request: Request): "content_type" | "cross_site" | null {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return "content_type";
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return "cross_site";
  return null;
}

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
    const rejected = rejectionReason(request);
    if (rejected) {
      logger.warn("lookup.rejected", { requestId, reason: rejected });
      return respond(startedAt, { status: "error" }, 403);
    }

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
      // Variable names only, never values: makes misconfiguration diagnosable from runtime logs.
      invalidEnv: error instanceof ConfigError ? error.fields.join(",") : undefined,
    });
    return respond(startedAt, { status: "error" }, 500);
  }
}
