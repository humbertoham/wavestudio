-- Capture existing labels before future catalog edits. Where available, the
-- historical payment amount is more accurate than today's catalog price.
UPDATE "PackPurchase" purchase
SET "nameSnapshot" = pack."name",
    "priceSnapshot" = COALESCE((SELECT payment."amount" FROM "Payment" payment WHERE payment."id" = purchase."paymentId"), pack."price")
FROM "Pack" pack
WHERE purchase."packId" = pack."id"
  AND purchase."nameSnapshot" IS NULL AND purchase."priceSnapshot" IS NULL;
