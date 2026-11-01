import { describe, expect, it, vi } from "vitest";
import { buildSeating, sampleProbes } from "@/server/seating-import";
import { VerifyUrlSchema, createHttpVerifier } from "@/server/seating-verify";
import { SAMPLE_CSV, TEST_DOMAINS, TEST_PEPPER } from "./helpers";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = "https://mesas.example";
const PROBES = [
  { email: "lucia.garcia@nexodigital.example", table: 7, tablemates: 1 },
  { email: "hugo.perez@atriasistemas.example", table: 42, tablemates: 0 },
];

function fakeFetch(...bodies: { status: number; body: unknown }[]): typeof fetch {
  const queue = [...bodies];
  return vi.fn(async () => {
    const next = queue.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
}

describe("createHttpVerifier (unit)", () => {
  it("passes when every probe resolves to its expected table", async () => {
    const fetchImpl = fakeFetch(
      { status: 200, body: { status: "found", table: 7, tablemates: [{ name: "Ana", company: "Nexo" }] } },
      { status: 200, body: { status: "found", table: 42, tablemates: [] } },
    );
    expect(await createHttpVerifier(BASE, fetchImpl)(PROBES)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/api/lookup`, expect.objectContaining({ method: "POST" }));
  });

  it.each([
    [{ status: 200, body: { status: "not_found" } }, /probe 1\/2: not_found \(EMAIL_HMAC_PEPPER/],
    [{ status: 500, body: { status: "error" } }, /deployment misconfigured/],
    [{ status: 429, body: { status: "rate_limited" } }, /rate limited/],
    [{ status: 200, body: { status: "found", table: 8, tablemates: [] } }, /expected table 7, got 8/],
    [{ status: 200, body: { status: "found", table: 7, tablemates: [] } }, /expected 1 tablemates, got 0/],
    [{ status: 200, body: { status: "found", table: 7 } }, /got none \(deployment running an older version\?\)/],
    [{ status: 502, body: "<html>bad gateway</html>" }, /unexpected response \(HTTP 502\)/],
  ])("fails with a diagnostic for %j", async (reply, reason) => {
    const result = await createHttpVerifier(BASE, fakeFetch(reply))(PROBES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(reason);
      expect(result.reason).not.toContain("lucia");
    }
  });
});

describe("VerifyUrlSchema", () => {
  it.each(["https://mesas-cena-espublico.vercel.app", "http://localhost:3000"])("accepts %s", (url) => {
    expect(VerifyUrlSchema.safeParse(url).success).toBe(true);
  });
  it.each(["http://mesas.example", "ftp://x", "not a url"])("rejects %s", (url) => {
    expect(VerifyUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe("createHttpVerifier against the real /api/lookup handler", () => {
  async function verifyAgainstDeployment(importPepper: string) {
    // Deployment side: route configured with TEST_PEPPER, data imported with `importPepper`.
    const seating = buildSeating(SAMPLE_CSV, TEST_DOMAINS, importPepper);
    const file = path.join(mkdtempSync(path.join(tmpdir(), "mesas-verify-")), "seating.json");
    writeFileSync(file, JSON.stringify(Object.fromEntries(seating)));
    vi.stubEnv("EMAIL_HMAC_PEPPER", TEST_PEPPER);
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", TEST_DOMAINS.join(","));
    vi.stubEnv("SEATING_STORE", "memory");
    vi.stubEnv("SEATING_MEMORY_FILE", file);
    vi.resetModules();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/lookup/route");

    const viaHandler = (async (input: RequestInfo | URL, init?: RequestInit) =>
      POST(new Request(input, init))) as typeof fetch;
    return createHttpVerifier(BASE, viaHandler)(sampleProbes(SAMPLE_CSV));
  }

  it("passes when import and deployment share the pepper", async () => {
    expect(await verifyAgainstDeployment(TEST_PEPPER)).toEqual({ ok: true });
  });

  it("detects a pepper mismatch (the silent-failure scenario)", async () => {
    const result = await verifyAgainstDeployment(`${TEST_PEPPER}-local-dev`);
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/not_found \(EMAIL_HMAC_PEPPER or ALLOWED_EMAIL_DOMAINS differ/),
    });
  });
});
