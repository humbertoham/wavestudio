import { describe, expect, it } from "vitest";
import { getWhatsAppHref, normalizePhoneForWhatsApp } from "./whatsapp";

describe("normalizePhoneForWhatsApp", () => {
  it("adds the Mexico country code to local 10-digit numbers", () => {
    expect(normalizePhoneForWhatsApp("8112345678")).toBe("528112345678");
  });

  it("preserves a sanitized number that already has the Mexico country code", () => {
    expect(normalizePhoneForWhatsApp("+52 81 1234 5678")).toBe(
      "528112345678"
    );
  });

  it("returns null for empty or missing phone numbers", () => {
    expect(normalizePhoneForWhatsApp("")).toBeNull();
    expect(normalizePhoneForWhatsApp(null)).toBeNull();
  });

  it("returns null for malformed phone numbers", () => {
    expect(normalizePhoneForWhatsApp("abc-123")).toBeNull();
  });
});

describe("getWhatsAppHref", () => {
  it("builds a plain wa.me URL for local Mexico phone numbers", () => {
    expect(getWhatsAppHref("8112345678")).toBe(
      "https://wa.me/528112345678"
    );
  });

  it("builds a wa.me URL with encoded message text", () => {
    expect(
      getWhatsAppHref(
        "+52 81 1234 5678",
        "Hola Ana, te contactamos de WAVE Studio."
      )
    ).toBe(
      "https://wa.me/528112345678?text=Hola%20Ana%2C%20te%20contactamos%20de%20WAVE%20Studio."
    );
  });

  it("returns null for empty or malformed phone numbers", () => {
    expect(getWhatsAppHref("")).toBeNull();
    expect(getWhatsAppHref(null)).toBeNull();
    expect(getWhatsAppHref("abc-123")).toBeNull();
  });
});
