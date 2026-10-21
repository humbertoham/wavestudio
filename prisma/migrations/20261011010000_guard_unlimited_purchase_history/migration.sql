-- Terms paid for cannot be changed by later catalog/payment updates.
CREATE FUNCTION "protect_package_purchase_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."unlimitedMonth" IS DISTINCT FROM OLD."unlimitedMonth"
    OR NEW."unlimitedYear" IS DISTINCT FROM OLD."unlimitedYear"
    OR (OLD."nameSnapshot" IS NOT NULL AND NEW."nameSnapshot" IS DISTINCT FROM OLD."nameSnapshot")
    OR (OLD."priceSnapshot" IS NOT NULL AND NEW."priceSnapshot" IS DISTINCT FROM OLD."priceSnapshot")
    OR (OLD."type" = 'MONTHLY_UNLIMITED' AND NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt")
  THEN RAISE EXCEPTION 'PURCHASE_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PackPurchase_protect_snapshot" BEFORE UPDATE ON "PackPurchase"
  FOR EACH ROW EXECUTE FUNCTION "protect_package_purchase_snapshot"();

CREATE FUNCTION "protect_payment_package_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."packSnapshot" IS NOT NULL AND NEW."packSnapshot" IS DISTINCT FROM OLD."packSnapshot"
  THEN RAISE EXCEPTION 'PAYMENT_PACKAGE_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Payment_protect_package_snapshot" BEFORE UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION "protect_payment_package_snapshot"();

-- An existing daily claim may not silently move to another calendar day/month.
CREATE FUNCTION "protect_unlimited_class_day"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."date" IS DISTINCT FROM OLD."date" AND EXISTS (
    SELECT 1 FROM "UnlimitedUsage" u JOIN "Booking" b ON b."id" = u."bookingId"
    WHERE b."classId" = OLD."id" AND u."releasedAt" IS NULL
      AND u."serviceDate" <> (NEW."date" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Monterrey')::date
  ) THEN RAISE EXCEPTION 'CLASS_HAS_UNLIMITED_USAGE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Class_protect_unlimited_day" BEFORE UPDATE OF "date" ON "Class"
  FOR EACH ROW EXECUTE FUNCTION "protect_unlimited_class_day"();

CREATE FUNCTION "validate_unlimited_usage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchase "PackPurchase"%ROWTYPE; booking "Booking"%ROWTYPE; starts timestamp;
BEGIN
  SELECT * INTO purchase FROM "PackPurchase" WHERE "id" = NEW."purchaseId" FOR SHARE;
  SELECT * INTO booking FROM "Booking" WHERE "id" = NEW."bookingId";
  SELECT "date" INTO starts FROM "Class" WHERE "id" = booking."classId" FOR SHARE;
  IF purchase."type" <> 'MONTHLY_UNLIMITED' OR purchase."userId" <> NEW."userId"
    OR purchase."revokedAt" IS NOT NULL OR booking."userId" IS DISTINCT FROM NEW."userId"
    OR booking."entitlementType" NOT IN ('MONTHLY_UNLIMITED', 'MIXED')
    OR NEW."serviceDate" <> (starts AT TIME ZONE 'UTC' AT TIME ZONE 'America/Monterrey')::date
    OR EXTRACT(MONTH FROM NEW."serviceDate") <> purchase."unlimitedMonth"
    OR EXTRACT(YEAR FROM NEW."serviceDate") <> purchase."unlimitedYear"
  THEN RAISE EXCEPTION 'INVALID_UNLIMITED_USAGE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "UnlimitedUsage_validate_claim" BEFORE INSERT ON "UnlimitedUsage"
  FOR EACH ROW EXECUTE FUNCTION "validate_unlimited_usage"();
