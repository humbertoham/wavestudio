export function withoutWellhubBookingIdentifiers<
  T extends Record<string, unknown>,
>(booking: T) {
  const {
    wellhubBookingNumber: _bookingNumber,
    wellhubUserId: _userId,
    wellhubSlotId: _slotId,
    wellhubLastEventAt: _lastEventAt,
    wellhubLateCanceledAt: _lateCanceledAt,
    ...safe
  } = booking;
  return safe;
}

export function withoutWellhubClassIdentifiers<T extends Record<string, unknown>>(
  cls: T
) {
  const {
    wellhubClassId: _classId,
    wellhubSlotId: _slotId,
    wellhubSyncError: _syncError,
    ...safe
  } = cls;
  return safe;
}
