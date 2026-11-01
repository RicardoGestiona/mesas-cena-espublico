import "server-only";
import { z } from "zod";
import { emailDomain, normalizeEmail } from "@/lib/email";
import { isValidTable } from "@/lib/venue";
import { hmacEmail } from "./crypto";
import { serverEnv, type ServerEnv } from "./env";
import { seatingRepository, type SeatingRepository } from "./seating-repository";

export const LookupRequestSchema = z.object({
  email: z.string().max(254),
});

export type LookupResult = { status: "found"; table: number } | { status: "not_found" };

const NOT_FOUND: LookupResult = { status: "not_found" };
const EmailFormat = z.email();

export interface LookupDeps {
  env: Pick<ServerEnv, "EMAIL_HMAC_PEPPER" | "ALLOWED_EMAIL_DOMAINS">;
  repository: SeatingRepository;
}

function defaultDeps(): LookupDeps {
  return { env: serverEnv(), repository: seatingRepository() };
}

/**
 * Resolves the table for an email. Invalid format, disallowed domain and
 * unknown email all collapse into the same `not_found` result, and every path
 * performs a store read so they are indistinguishable by timing.
 */
export async function lookupTable(
  rawEmail: string,
  { env, repository }: LookupDeps = defaultDeps(),
): Promise<LookupResult> {
  const email = normalizeEmail(rawEmail);
  const eligible =
    EmailFormat.safeParse(email).success && env.ALLOWED_EMAIL_DOMAINS.includes(emailDomain(email));

  // Always hash + read, even when ineligible, to avoid a timing oracle.
  const digest = hmacEmail(eligible ? email : `ineligible:${email}`, env.EMAIL_HMAC_PEPPER);
  const table = await repository.findTable(digest);

  if (!eligible || table === null || !isValidTable(table)) return NOT_FOUND;
  return { status: "found", table };
}
