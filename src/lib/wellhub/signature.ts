import { createHmac, timingSafeEqual } from "node:crypto";

export const WELLHUB_SIGNATURE_HEADER = "x-gympass-signature";

export type WellhubSignatureResult =
  | { ok: true }
  | {
      ok: false;
      reason: "MISSING_SIGNATURE" | "MALFORMED_SIGNATURE" | "SIGNATURE_MISMATCH";
    };

export function computeWellhubSignature(
  rawBody: string | Uint8Array,
  secret: string
) {
  return createHmac("sha1", secret)
    .update(rawBody)
    .digest("hex")
    .toUpperCase();
}

export function verifyWellhubSignature(params: {
  rawBody: string | Uint8Array;
  signature: string | null;
  secret: string;
}): WellhubSignatureResult {
  const header = params.signature?.trim();
  if (!header) return { ok: false, reason: "MISSING_SIGNATURE" };

  // The official examples sometimes prefix the uppercase SHA-1 digest with
  // `0X`, while the official generation snippets return the 40 hex digits.
  const normalized = header.replace(/^0x/i, "").toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(normalized)) {
    return { ok: false, reason: "MALFORMED_SIGNATURE" };
  }

  const expected = computeWellhubSignature(params.rawBody, params.secret);
  const actualBytes = Buffer.from(normalized, "ascii");
  const expectedBytes = Buffer.from(expected, "ascii");

  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    return { ok: false, reason: "SIGNATURE_MISMATCH" };
  }

  return { ok: true };
}
