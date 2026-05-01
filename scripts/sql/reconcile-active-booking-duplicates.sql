BEGIN;

SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE "Booking" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "TokenLedger" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE booking_duplicate_groups ON COMMIT DROP AS
SELECT
  "userId",
  "classId",
  COUNT(*)::int AS row_count,
  COALESCE(SUM(quantity), 0)::int AS merged_quantity
FROM "Booking"
WHERE "status" = 'ACTIVE'
  AND "userId" IS NOT NULL
GROUP BY "userId", "classId"
HAVING COUNT(*) > 1;

CREATE TEMP TABLE booking_duplicate_rows ON COMMIT DROP AS
SELECT
  b.id AS booking_id,
  FIRST_VALUE(b.id) OVER booking_group AS canonical_booking_id,
  b."userId",
  b."classId",
  b.quantity,
  b.attended,
  b."createdAt",
  b."canceledAt",
  b."refundToken",
  ROW_NUMBER() OVER booking_group AS row_number,
  SUM(b.quantity) OVER (PARTITION BY b."userId", b."classId")::int AS merged_quantity,
  BOOL_OR(b.attended) OVER (PARTITION BY b."userId", b."classId") AS merged_attended
FROM "Booking" AS b
INNER JOIN booking_duplicate_groups AS g
  ON g."userId" = b."userId"
 AND g."classId" = b."classId"
WINDOW booking_group AS (
  PARTITION BY b."userId", b."classId"
  ORDER BY b."createdAt" ASC, b.id ASC
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM booking_duplicate_rows) THEN
    RAISE NOTICE 'No duplicate ACTIVE bookings found.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM booking_duplicate_rows
    WHERE quantity < 1
       OR "canceledAt" IS NOT NULL
       OR "refundToken" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cleanup aborted: duplicate ACTIVE bookings contain unexpected canceled/refund state.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM booking_duplicate_rows AS rows
    INNER JOIN "TokenLedger" AS ledger
      ON ledger."bookingId" = rows.booking_id
    WHERE ledger.reason = 'CANCEL_REFUND'
  ) THEN
    RAISE EXCEPTION
      'Cleanup aborted: duplicate ACTIVE bookings with CANCEL_REFUND ledger entries were found.';
  END IF;
END $$;

SELECT
  "userId",
  "classId",
  COUNT(*)::int AS active_rows,
  MAX(merged_quantity)::int AS merged_quantity,
  STRING_AGG(booking_id, ', ' ORDER BY "createdAt", booking_id) AS booking_ids
FROM booking_duplicate_rows
GROUP BY "userId", "classId"
ORDER BY active_rows DESC, MIN("createdAt") ASC;

UPDATE "Booking" AS canonical
SET quantity = merged.merged_quantity,
    attended = merged.merged_attended
FROM (
  SELECT DISTINCT
    canonical_booking_id,
    merged_quantity,
    merged_attended
  FROM booking_duplicate_rows
) AS merged
WHERE canonical.id = merged.canonical_booking_id;

UPDATE "TokenLedger" AS ledger
SET "bookingId" = rows.canonical_booking_id
FROM booking_duplicate_rows AS rows
WHERE rows.row_number > 1
  AND ledger."bookingId" = rows.booking_id;

UPDATE "Booking" AS duplicate
SET "status" = 'CANCELED',
    "canceledAt" = NOW()
FROM booking_duplicate_rows AS rows
WHERE rows.row_number > 1
  AND duplicate.id = rows.booking_id;

SELECT
  "userId",
  "classId",
  MAX(CASE WHEN row_number = 1 THEN canonical_booking_id END) AS canonical_booking_id,
  COUNT(*) FILTER (WHERE row_number > 1)::int AS canceled_rows,
  MAX(merged_quantity)::int AS canonical_quantity
FROM booking_duplicate_rows
GROUP BY "userId", "classId"
ORDER BY "userId", "classId";

COMMIT;
