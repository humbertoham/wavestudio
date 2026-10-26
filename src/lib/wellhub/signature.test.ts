import { describe, expect, it } from "vitest";

import {
  computeWellhubSignature,
  verifyWellhubSignature,
} from "@/lib/wellhub/signature";

describe("Wellhub webhook signature", () => {
  const secret = "wellhub-test-secret";
  const rawBody = '{"event_type":"checkin"}';

  it("accepts a valid uppercase HMAC-SHA1 signature", () => {
    const signature = computeWellhubSignature(rawBody, secret);

    expect(verifyWellhubSignature({ rawBody, signature, secret })).toEqual({
      ok: true,
    });
  });

  it("accepts the official example's optional 0X prefix", () => {
    const signature = `0X${computeWellhubSignature(rawBody, secret)}`;

    expect(verifyWellhubSignature({ rawBody, signature, secret })).toEqual({
      ok: true,
    });
  });

  it("rejects an invalid signature", () => {
    expect(
      verifyWellhubSignature({
        rawBody,
        signature: "A".repeat(40),
        secret,
      })
    ).toEqual({ ok: false, reason: "SIGNATURE_MISMATCH" });
  });

  it("rejects a missing signature", () => {
    expect(
      verifyWellhubSignature({ rawBody, signature: null, secret })
    ).toEqual({ ok: false, reason: "MISSING_SIGNATURE" });
  });

  it("handles malformed signatures safely", () => {
    expect(
      verifyWellhubSignature({ rawBody, signature: "not-a-sha1", secret })
    ).toEqual({ ok: false, reason: "MALFORMED_SIGNATURE" });
  });
});
