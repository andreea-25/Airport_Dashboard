-- CreateEnum
CREATE TYPE "AvailabilityType" AS ENUM ('LEAVE', 'MATERNITY', 'SECONDMENT', 'TRAINING', 'RESIGNATION', 'CONTRACT_END', 'OTHER');
CREATE TYPE "Readiness" AS ENUM ('GREEN', 'ORANGE', 'RED');
CREATE TYPE "CandidateStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "contractEndDate" DATE;
ALTER TABLE "Skill" ADD COLUMN     "trainingDays" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "AvailabilityEvent" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "AvailabilityType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "announcedAt" DATE,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AvailabilityEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReadinessOverride" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "color" "Readiness" NOT NULL,
    "reason" TEXT NOT NULL,
    "validUntil" DATE,
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReadinessOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "university" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "studyYear" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventDate" DATE,
    "interests" TEXT[],
    "availableFrom" DATE,
    "consentAt" TIMESTAMP(3),
    "status" "CandidateStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "hiredEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateSkill" (
    "candidateId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "proficiency" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "CandidateSkill_pkey" PRIMARY KEY ("candidateId","skillId")
);

-- CreateIndex
CREATE INDEX "AvailabilityEvent_employeeId_idx" ON "AvailabilityEvent"("employeeId");
CREATE INDEX "ReadinessOverride_employeeId_idx" ON "ReadinessOverride"("employeeId");
CREATE UNIQUE INDEX "Candidate_email_key" ON "Candidate"("email");
CREATE UNIQUE INDEX "Candidate_hiredEmployeeId_key" ON "Candidate"("hiredEmployeeId");

-- AddForeignKey
ALTER TABLE "AvailabilityEvent" ADD CONSTRAINT "AvailabilityEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReadinessOverride" ADD CONSTRAINT "ReadinessOverride_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateSkill" ADD CONSTRAINT "CandidateSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
