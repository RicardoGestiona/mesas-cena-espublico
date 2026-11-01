import { beforeEach, describe, expect, it, vi } from "vitest";
import { hmacEmail } from "@/server/crypto";
import { TEST_DOMAINS, TEST_PEPPER, writeHashedSeating } from "./helpers";

const MIN_RESPONSE_MS = 250;
const LUCIA = "lucia.garcia@nexodigital.example";
let ipCounter = 0;

type PostHandler = (request: Request) => Promise<Response>;

/** Fresh module graph per test so env/repository/rate-limiter singletons are rebuilt. */
async function loadRoute(env: Record<string, string> = {}): Promise<PostHandler> {
  vi.stubEnv("EMAIL_HMAC_PEPPER", TEST_PEPPER);
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", TEST_DOMAINS.join(","));
  vi.stubEnv("SEATING_STORE", "memory");
  vi.stubEnv("SEATING_MEMORY_FILE", writeHashedSeating());
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return (await import("@/app/api/lookup/route")).POST;
}

function request(body: string, ip = `10.0.0.${++ipCounter}`): Request {
  return new Request("http://localhost/api/lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 203.0.113.9` },
    body,
  });
}

const json = (value: unknown) => JSON.stringify(value);

describe("POST /api/lookup", () => {
  let POST: PostHandler;

  beforeEach(async () => {
    POST = await loadRoute();
  });

  it("returns only status and table for a known attendee", async () => {
    const response = await POST(request(json({ email: LUCIA })));
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ status: "found", table: 7 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers every miss with a byte-identical body and status", async () => {
    const misses = [
      json({ email: "nadie@nexodigital.example" }),
      json({ email: "lucia.garcia@gmail.com" }),
      json({ email: "not-an-email" }),
      json({ email: 42 }),
      json({ wrong: "shape" }),
      "not json",
      "",
      json({ email: `${"a".repeat(2000)}@nexodigital.example` }),
    ];
    const results = await Promise.all(
      misses.map(async (body) => {
        const response = await POST(request(body));
        return `${response.status}:${await response.text()}`;
      }),
    );
    expect(new Set(results)).toEqual(new Set([`200:${json({ status: "not_found" })}`]));
  });

  it("enforces the minimum latency on hits and misses alike", async () => {
    for (const body of [json({ email: LUCIA }), json({ email: "nadie@nexodigital.example" }), "garbage"]) {
      const startedAt = performance.now();
      await POST(request(body));
      // Small tolerance for timer coarseness.
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(MIN_RESPONSE_MS - 5);
    }
  });

  it("rate-limits per client IP and keeps other IPs unaffected", async () => {
    POST = await loadRoute({ RATE_LIMIT_PER_MINUTE: "3" });
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () => POST(request(json({ email: LUCIA }), "198.51.100.7")).then((r) => r.status)),
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);

    const other = await POST(request(json({ email: LUCIA }), "198.51.100.8"));
    expect(other.status).toBe(200);
  });

  it("logs no email, digest or IP", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));

    await POST(request(json({ email: LUCIA }), "192.0.2.55"));
    await POST(request(json({ email: "nadie@nexodigital.example" }), "192.0.2.55"));

    const output = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [LUCIA, "lucia", "nadie", "nexodigital", hmacEmail(LUCIA, TEST_PEPPER), "192.0.2.55"]) {
      expect(output).not.toContain(secret);
    }
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("fails closed with a generic error when the store is unavailable", async () => {
    POST = await loadRoute({ SEATING_MEMORY_FILE: "/nonexistent/seating.json" });
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void errors.push(String(line)));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await POST(request(json({ email: LUCIA })));
    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ status: "error" });
    expect(errors.join("\n")).not.toContain("/nonexistent");
  });

  it("refuses to boot with an invalid environment", async () => {
    POST = await loadRoute({ EMAIL_HMAC_PEPPER: "too-short" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(request(json({ email: LUCIA })));
    expect(response.status).toBe(500);
  });
});
