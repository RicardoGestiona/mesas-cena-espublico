import { z } from "zod";

/**
 * Contract of `POST /api/lookup`, shared by the client, the route and the import verifier.
 * `privacyNoticeAccepted` must be literally `true`: the attendee acknowledged the privacy
 * notice before the lookup. Any other body collapses into the uniform `not_found`.
 */
export const LookupRequestSchema = z.object({
  email: z.string().max(254),
  privacyNoticeAccepted: z.literal(true),
});

export type LookupRequest = z.infer<typeof LookupRequestSchema>;

export function lookupRequestBody(email: string): string {
  return JSON.stringify({ email, privacyNoticeAccepted: true } satisfies LookupRequest);
}
