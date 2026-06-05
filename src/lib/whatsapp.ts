export function normalizePhoneForWhatsApp(phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;

  const normalized = digits.startsWith("00") ? digits.slice(2) : digits;
  const withCountryCode =
    normalized.length === 10 ? `52${normalized}` : normalized;

  if (withCountryCode.length < 11 || withCountryCode.length > 15) {
    return null;
  }

  return withCountryCode;
}

export function getWhatsAppHref(
  phone?: string | null,
  message?: string | null
) {
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) return null;

  const text = message?.trim()
    ? `?text=${encodeURIComponent(message.trim())}`
    : "";

  return `https://wa.me/${normalizedPhone}${text}`;
}
