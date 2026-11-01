import "server-only";
import { z } from "zod";
import { emailDomain, normalizeEmail } from "@/lib/email";
import { isValidTable } from "@/lib/venue";
import { hmacEmail } from "./crypto";
import { serverEnv } from "./env";
import { seatingRepository } from "./seating-repository";

export const LookupRequestSchema = z.object({
  email: z.string().max(254),
});

export type LookupResult = { status: "found"; table: number } | { status: "not_found" };

const NOT_FOUND: LookupResult = { status: "not_found" };
const EmailFormat = z.email();

/**
 * Resolves the table for an email. Invalid format, disallowed domain and
 * unknown email all collapse into the same `not_found` result, and every path
 * performs a store read so they are indistinguishable by timing.
 */
export async function lookupTable(rawEmail: string): Promise<LookupResult> {
  const env = serverEnv();
  const email = normalizeEmail(rawEmail);
  const eligible =
    EmailFormat.safeParse(email).success && env.ALLOWED_EMAIL_DOMAINS.includes(emailDomain(email));

  // Always hash + read, even when ineligible, to avoid a timing oracle.
  const digest = hmacEmail(eligible ? email : `ineligible:${email}`, env.EMAIL_HMAC_PEPPER);
  const table = await seatingRepository().findTable(digest);

  if (!eligible || table === null || !isValidTable(table)) return NOT_FOUND;
  return { status: "found", table };
}
