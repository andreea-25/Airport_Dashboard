-- Recruiting projects (courses, presentations, competitions) and former employees
CREATE TYPE "ProjectType" AS ENUM ('COURSE', 'PRESENTATION', 'COMPETITION', 'HACKATHON', 'INTERNSHIP', 'OPEN_DAY', 'WEBINAR');
CREATE TYPE "ProjectStatus" AS ENUM ('PROPOSED', 'PLANNED', 'ONGOING', 'DONE', 'CANCELLED');

ALTER TABLE "Employee" ADD COLUMN "leftAt" DATE;
ALTER TABLE "Employee" ADD COLUMN "leaveReason" TEXT;
ALTER TABLE "Employee" ADD COLUMN "rehireEligible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Employee" ADD COLUMN "leaveNote" TEXT;

CREATE TABLE "RecruitingProject" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL,
    "institution" TEXT NOT NULL,
    "targetDepartments" TEXT[],
    "startDate" DATE,
    "endDate" DATE,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PROPOSED',
    "description" TEXT,
    "expectedReach" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecruitingProject_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Candidate" ADD COLUMN "projectId" TEXT;
CREATE INDEX "Candidate_projectId_idx" ON "Candidate"("projectId");
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RecruitingProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
