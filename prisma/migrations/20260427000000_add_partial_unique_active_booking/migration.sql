-- Enforce one ACTIVE user booking per class at the database level.
-- Prisma does not model PostgreSQL partial unique indexes directly,
-- so this migration is intentionally manual SQL.

DO $$
DECLARE
  duplicate_summary text;
BEGIN
  SELECT string_agg(
    format(
      'userId=%s classId=%s activeRows=%s bookingIds=[%s]',
      "userId",
      "classId",
      active_count,
      booking_ids
    ),
    E'\n'
  )
  INTO duplicate_summary
  FROM (
    SELECT
      "userId",
      "classId",
      COUNT(*)::text AS active_count,
      string_agg("id", ', ' ORDER BY "createdAt") AS booking_ids
    FROM "Booking"
    WHERE "status" = 'ACTIVE'
      AND "userId" IS NOT NULL
    GROUP BY "userId", "classId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, MIN("createdAt") ASC
    LIMIT 25
  ) AS duplicates;

  IF duplicate_summary IS NOT NULL THEN
    RAISE NOTICE 'Duplicate ACTIVE bookings detected before unique index creation:%',
      E'\n' || duplicate_summary;

    RAISE EXCEPTION
      'Cannot create Booking_userId_classId_active_unique while duplicate ACTIVE bookings exist. Resolve duplicate ACTIVE rows first, then rerun the migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Booking_userId_classId_active_unique"
ON "Booking" ("userId", "classId")
WHERE "status" = 'ACTIVE'
  AND "userId" IS NOT NULL;
