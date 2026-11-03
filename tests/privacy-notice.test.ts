import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LookupRequestSchema, lookupRequestBody } from "@/lib/lookup-request";
import { PRIVACY_NOTICE } from "@/lib/privacy-notice";

describe("privacy notice", () => {
  it("has real controller and rights contact (no placeholders)", () => {
    for (const value of Object.values(PRIVACY_NOTICE)) expect(value).not.toMatch(/[<>]/);
    expect(z.email().safeParse(PRIVACY_NOTICE.rightsContactEmail).success).toBe(true);
  });
});

describe("lookup request contract", () => {
  it("accepts only an explicit acknowledgement", () => {
    expect(LookupRequestSchema.safeParse(JSON.parse(lookupRequestBody("a@b.example"))).success).toBe(true);
    for (const ack of [undefined, false, "true", 1]) {
      expect(LookupRequestSchema.safeParse({ email: "a@b.example", privacyNoticeAccepted: ack }).success).toBe(false);
    }
  });
});
