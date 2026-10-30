-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EMPLOYEE');
CREATE TYPE "SkillType" AS ENUM ('SKILL', 'CERTIFICATION');
CREATE TYPE "RequestType" AS ENUM ('SHIFT_SWAP', 'LEAVE', 'CAREER_INFO', 'OTHER');
CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED');
CREATE TYPE "AiMode" AS ENUM ('EMPLOYEE', 'ADMIN_SIM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "departmentId" TEXT NOT NULL,
    "teamId" TEXT,
    "levelId" TEXT NOT NULL,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "levelSince" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "SkillType" NOT NULL,
    "hasExpiry" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeSkill" (
    "employeeId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "proficiency" INTEGER NOT NULL DEFAULT 1,
    "obtainedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("employeeId","skillId")
);

CREATE TABLE "LevelRequirement" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "minProficiency" INTEGER NOT NULL DEFAULT 1,
    "minMonthsInPrevLevel" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LevelRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PositionSkill" (
    "positionId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "minProficiency" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "PositionSkill_pkey" PRIMARY KEY ("positionId","skillId")
);

CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "teamId" TEXT,
    "date" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT,
    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "positionId" TEXT,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffingRequirement" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "minStaff" INTEGER NOT NULL,
    CONSTRAINT "StaffingRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftComment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentId" TEXT,
    CONSTRAINT "ShiftComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdByAI" BOOLEAN NOT NULL DEFAULT false,
    "adminResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "refId" TEXT,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "baseSnapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScenarioShift" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "sourceShiftId" TEXT,
    "departmentId" TEXT NOT NULL,
    "teamId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScenarioShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScenarioAssignment" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioShiftId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "positionId" TEXT,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ScenarioAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScenarioEmployeeOverride" (
    "scenarioId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "teamId" TEXT,
    "departmentId" TEXT,
    "levelId" TEXT,
    CONSTRAINT "ScenarioEmployeeOverride_pkey" PRIMARY KEY ("scenarioId","employeeId")
);

CREATE TABLE "ScenarioChange" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "inverse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScenarioChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScenarioSuggestion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AI',
    "changes" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "estimatedImpact" JSONB,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScenarioSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL,
    "scenarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");
CREATE UNIQUE INDEX "Level_name_key" ON "Level"("name");
CREATE UNIQUE INDEX "Level_rank_key" ON "Level"("rank");
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");
CREATE UNIQUE INDEX "Skill_code_key" ON "Skill"("code");
CREATE UNIQUE INDEX "LevelRequirement_departmentId_levelId_skillId_key" ON "LevelRequirement"("departmentId", "levelId", "skillId");
CREATE INDEX "Shift_startAt_idx" ON "Shift"("startAt");
CREATE INDEX "Shift_departmentId_startAt_idx" ON "Shift"("departmentId", "startAt");
CREATE UNIQUE INDEX "ShiftAssignment_shiftId_employeeId_key" ON "ShiftAssignment"("shiftId", "employeeId");
CREATE INDEX "StaffingRequirement_departmentId_dayOfWeek_idx" ON "StaffingRequirement"("departmentId", "dayOfWeek");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "ScenarioShift_scenarioId_idx" ON "ScenarioShift"("scenarioId");
CREATE INDEX "ScenarioAssignment_scenarioId_idx" ON "ScenarioAssignment"("scenarioId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LevelRequirement" ADD CONSTRAINT "LevelRequirement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LevelRequirement" ADD CONSTRAINT "LevelRequirement_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LevelRequirement" ADD CONSTRAINT "LevelRequirement_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PositionSkill" ADD CONSTRAINT "PositionSkill_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PositionSkill" ADD CONSTRAINT "PositionSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffingRequirement" ADD CONSTRAINT "StaffingRequirement_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftComment" ADD CONSTRAINT "ShiftComment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftComment" ADD CONSTRAINT "ShiftComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftComment" ADD CONSTRAINT "ShiftComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ShiftComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Request" ADD CONSTRAINT "Request_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScenarioShift" ADD CONSTRAINT "ScenarioShift_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScenarioAssignment" ADD CONSTRAINT "ScenarioAssignment_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScenarioAssignment" ADD CONSTRAINT "ScenarioAssignment_scenarioShiftId_fkey" FOREIGN KEY ("scenarioShiftId") REFERENCES "ScenarioShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScenarioEmployeeOverride" ADD CONSTRAINT "ScenarioEmployeeOverride_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScenarioChange" ADD CONSTRAINT "ScenarioChange_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScenarioSuggestion" ADD CONSTRAINT "ScenarioSuggestion_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
