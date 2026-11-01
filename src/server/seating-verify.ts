import { z } from "zod";
import type { Probe } from "./seating-import";
import type { Verifier } from "./seating-publish";

/**
 * Verifies a published import through the real deployed endpoint, which
 * catches pepper, domain or deployment mismatches that a store-level check
 * cannot. Messages never include emails.
 */

const LookupResponse = z.object({
  status: z.string(),
  table: z.number().optional(),
  tablemates: z.array(z.object({ name: z.string(), company: z.string() })).optional(),
});

const HINTS: Record<string, string> = {
  not_found: "EMAIL_HMAC_PEPPER or ALLOWED_EMAIL_DOMAINS differ between this import and the deployment",
  error: "deployment misconfigured (env vars / Redis) or not redeployed after changing them",
  rate_limited: "rate limited; wait a minute and retry",
};

export const VerifyUrlSchema = z
  .url()
  .refine((value) => {
    // Zod 4 runs refinements even after z.url() fails; never let `new URL` throw.
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  }, "must be https (http only for localhost)");

export function createHttpVerifier(baseUrl: string, fetchImpl: typeof fetch = fetch): Verifier {
  const endpoint = new URL("/api/lookup", baseUrl).toString();

  return async (probes: readonly Probe[]) => {
    for (const [index, probe] of probes.entries()) {
      const label = `probe ${index + 1}/${probes.length}`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: probe.email }),
        cache: "no-store",
      });
      const parsed = LookupResponse.safeParse(await response.json().catch(() => null));
      if (!parsed.success) return { ok: false, reason: `${label}: unexpected response (HTTP ${response.status})` };

      const { status, table, tablemates } = parsed.data;
      if (status !== "found") {
        return { ok: false, reason: `${label}: ${status} (${HINTS[status] ?? `HTTP ${response.status}`})` };
      }
      if (table !== probe.table) {
        return { ok: false, reason: `${label}: expected table ${probe.table}, got ${table} (stale or concurrent import?)` };
      }
      if (tablemates?.length !== probe.tablemates) {
        return {
          ok: false,
          reason: `${label}: expected ${probe.tablemates} tablemates, got ${tablemates?.length ?? "none"} (deployment running an older version?)`,
        };
      }
    }
    return { ok: true };
  };
}
