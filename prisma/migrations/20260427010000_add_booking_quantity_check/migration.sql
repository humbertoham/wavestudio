DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Booking"
    WHERE "quantity" < 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create Booking_quantity_positive_check while Booking rows with quantity < 1 exist.';
  END IF;
END $$;

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_quantity_positive_check"
CHECK ("quantity" >= 1);
