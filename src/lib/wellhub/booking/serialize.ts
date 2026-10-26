const privateFields = new Set([
  "wellhubBookingNumber", "wellhubUserId", "wellhubSlotId", "wellhubClassId",
  "wellhubLastEventAt", "wellhubLateCanceledAt", "wellhubSyncError",
]);

// Includes can nest classes under bookings or attendees under classes.
// Preserve non-plain Prisma values (Dates/Decimals) and all MAIN DTO fields.
function withoutProviderReferences<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutProviderReferences) as T;
  if (!value || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !privateFields.has(key))
    .map(([key, item]) => [key, withoutProviderReferences(item)])) as T;
}

export function withoutWellhubBookingIdentifiers<T extends Record<string, unknown>>(booking: T) {
  return withoutProviderReferences(booking);
}

export function withoutWellhubClassIdentifiers<T extends Record<string, unknown>>(cls: T) {
  return withoutProviderReferences(cls);
}
