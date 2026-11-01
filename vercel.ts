import type { VercelConfig } from "@vercel/config/v1";

/**
 * Versioned Vercel project configuration (overrides dashboard settings).
 * Functions run in Frankfurt (fra1): attendee lookups are processed in the EU
 * and co-located with the Upstash Redis store (eu-central-1).
 */
export const config: VercelConfig = {
  framework: "nextjs",
  regions: ["fra1"],
};
