-- CreateEnum
CREATE TYPE "public"."Affiliation" AS ENUM ('NONE', 'WELLHUB', 'TOTALPASS');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "affiliation" "public"."Affiliation" DEFAULT 'NONE',
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "emergencyPhone" VARCHAR(20),
ADD COLUMN     "phone" VARCHAR(20);
