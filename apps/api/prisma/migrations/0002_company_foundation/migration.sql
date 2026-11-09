-- v0.2.0 company foundation: employee identity layer, task numbers, owner position, terminal history.

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PENDING_ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "employeeCode" TEXT,
ADD COLUMN "employmentStatus" "EmploymentStatus",
ADD COLUMN "avatarId" TEXT,
ADD COLUMN "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "taskNumber" INTEGER;

-- CreateTable
CREATE TABLE "Counter" (
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("workspaceId", "key")
);

-- CreateTable
CREATE TABLE "CharacterPosition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "input" TEXT NOT NULL,
    "command" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "auditId" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandExecution_pkey" PRIMARY KEY ("id")
);

-- Backfill (assumption, documented in docs/decisions.md): agents that already existed in v0.1.0 were operating
-- agents, so they become ACTIVE employees EMP-001.. in creation order; existing tasks get TASK-001.. likewise.
WITH n AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "workspaceId" ORDER BY "createdAt", "id") AS rn FROM "Agent"
)
UPDATE "Agent" a SET "employeeCode" = 'EMP-' || LPAD(n.rn::text, 3, '0'), "employmentStatus" = 'ACTIVE' FROM n WHERE a."id" = n."id";

WITH n AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "workspaceId" ORDER BY "createdAt", "id") AS rn FROM "Task"
)
UPDATE "Task" t SET "taskNumber" = n.rn FROM n WHERE t."id" = n."id";

INSERT INTO "Counter" ("workspaceId", "key", "value")
SELECT "workspaceId", 'employee', COUNT(*) FROM "Agent" GROUP BY "workspaceId";
INSERT INTO "Counter" ("workspaceId", "key", "value")
SELECT "workspaceId", 'task', COUNT(*) FROM "Task" GROUP BY "workspaceId";

-- CreateIndex
CREATE UNIQUE INDEX "Agent_workspaceId_employeeCode_key" ON "Agent"("workspaceId", "employeeCode");
CREATE UNIQUE INDEX "Task_workspaceId_taskNumber_key" ON "Task"("workspaceId", "taskNumber");
CREATE UNIQUE INDEX "CharacterPosition_workspaceId_userId_key" ON "CharacterPosition"("workspaceId", "userId");
CREATE INDEX "CommandExecution_workspaceId_userId_createdAt_idx" ON "CommandExecution"("workspaceId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Counter" ADD CONSTRAINT "Counter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterPosition" ADD CONSTRAINT "CharacterPosition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterPosition" ADD CONSTRAINT "CharacterPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommandExecution" ADD CONSTRAINT "CommandExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommandExecution" ADD CONSTRAINT "CommandExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
