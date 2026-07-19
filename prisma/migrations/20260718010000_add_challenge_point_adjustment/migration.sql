-- AddTable
CREATE TABLE "ChallengePointAdjustment" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "activationVersion" INTEGER NOT NULL,
    "previousPoints" INTEGER NOT NULL,
    "newPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengePointAdjustment_pkey" PRIMARY KEY ("id")
);

-- Current Challenge points are non-negative and admin inputs are capped by the
-- application at 1,000,000. These checks also protect direct database writes.
ALTER TABLE "ChallengePointAdjustment"
ADD CONSTRAINT "ChallengePointAdjustment_activationVersion_check"
CHECK ("activationVersion" >= 1),
ADD CONSTRAINT "ChallengePointAdjustment_previousPoints_check"
CHECK ("previousPoints" BETWEEN 0 AND 1000000),
ADD CONSTRAINT "ChallengePointAdjustment_newPoints_check"
CHECK ("newPoints" BETWEEN 0 AND 1000000);

-- AddIndex
CREATE INDEX "ChallengePointAdjustment_challengeId_userId_createdAt_idx"
ON "ChallengePointAdjustment"("challengeId", "userId", "createdAt");

-- AddIndex
CREATE INDEX "ChallengePointAdjustment_actorUserId_createdAt_idx"
ON "ChallengePointAdjustment"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChallengePointAdjustment"
ADD CONSTRAINT "ChallengePointAdjustment_challengeId_fkey"
FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengePointAdjustment"
ADD CONSTRAINT "ChallengePointAdjustment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengePointAdjustment"
ADD CONSTRAINT "ChallengePointAdjustment_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
