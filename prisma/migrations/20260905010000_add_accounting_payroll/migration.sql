-- Add nullable rates so legacy instructors/classes remain readable without
-- fabricating historical payroll. Application flows require them going forward.
ALTER TABLE "Instructor"
ADD COLUMN "payrollRate" DECIMAL(10,2);

ALTER TABLE "Instructor"
ADD CONSTRAINT "Instructor_payrollRate_check"
CHECK ("payrollRate" IS NULL OR "payrollRate" > 0);

ALTER TABLE "Class"
ADD COLUMN "payrollRateSnapshot" DECIMAL(10,2),
ADD COLUMN "payrollRateEffectiveAt" TIMESTAMP(3);

ALTER TABLE "Class"
ADD CONSTRAINT "Class_payrollRateSnapshot_check"
CHECK ("payrollRateSnapshot" IS NULL OR "payrollRateSnapshot" > 0),
ADD CONSTRAINT "Class_payrollRateSnapshot_pair_check"
CHECK (
  ("payrollRateSnapshot" IS NULL AND "payrollRateEffectiveAt" IS NULL)
  OR
  ("payrollRateSnapshot" IS NOT NULL AND "payrollRateEffectiveAt" IS NOT NULL)
);

CREATE INDEX "Class_date_instructorId_idx"
ON "Class"("date", "instructorId");

CREATE TYPE "AccountingAuditType" AS ENUM (
  'INSTRUCTOR_RATE_CHANGED',
  'CLASS_INSTRUCTOR_REASSIGNED'
);

CREATE TABLE "AccountingAudit" (
  "id" TEXT NOT NULL,
  "type" "AccountingAuditType" NOT NULL,
  "instructorId" TEXT,
  "instructorName" TEXT,
  "classId" TEXT,
  "classTitle" TEXT,
  "previousInstructorId" TEXT,
  "previousInstructorName" TEXT,
  "newInstructorId" TEXT,
  "newInstructorName" TEXT,
  "previousRate" DECIMAL(10,2),
  "newRate" DECIMAL(10,2),
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccountingAudit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AccountingAudit"
ADD CONSTRAINT "AccountingAudit_previousRate_check"
CHECK ("previousRate" IS NULL OR "previousRate" > 0),
ADD CONSTRAINT "AccountingAudit_newRate_check"
CHECK ("newRate" IS NULL OR "newRate" > 0);

CREATE INDEX "AccountingAudit_instructorId_createdAt_idx"
ON "AccountingAudit"("instructorId", "createdAt");

CREATE INDEX "AccountingAudit_classId_createdAt_idx"
ON "AccountingAudit"("classId", "createdAt");

CREATE INDEX "AccountingAudit_actorUserId_createdAt_idx"
ON "AccountingAudit"("actorUserId", "createdAt");

ALTER TABLE "AccountingAudit"
ADD CONSTRAINT "AccountingAudit_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
