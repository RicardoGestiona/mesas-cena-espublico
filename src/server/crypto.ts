import { createHmac } from "node:crypto";

/** Pseudonymous, keyed identifier for a normalized email. Hex-encoded HMAC-SHA256. */
export function hmacEmail(normalizedEmail: string, pepper: string): string {
  return createHmac("sha256", pepper).update(normalizedEmail, "utf8").digest("hex");
}
