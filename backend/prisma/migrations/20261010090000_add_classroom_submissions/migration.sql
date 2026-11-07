-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assignmentDescription" TEXT,
    "textContent" TEXT NOT NULL,
    "state" TEXT,
    "grade" TEXT,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "maxScore" INTEGER,
    "approachAnalysis" JSONB,
    "attachmentsJson" JSONB,
    "sourceLabel" TEXT,
    "externalProvider" TEXT,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "driveFileId" TEXT,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Submission_userId_externalProvider_externalId_key" ON "Submission"("userId", "externalProvider", "externalId");

-- CreateIndex
CREATE INDEX "Submission_userId_subjectId_createdAt_idx" ON "Submission"("userId", "subjectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;