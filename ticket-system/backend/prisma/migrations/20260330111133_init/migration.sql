-- CreateEnum
CREATE TYPE "CustomerTier" AS ENUM ('NORMAL', 'KEY', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "EngineerLevel" AS ENUM ('L1', 'L2', 'L3');

-- CreateEnum
CREATE TYPE "EngineerRole" AS ENUM ('ENGINEER', 'ADMIN');

-- CreateEnum
CREATE TYPE "OperatorRole" AS ENUM ('OPERATOR');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'PENDING_CLOSE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('NORMAL', 'PRIORITY', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('taiji', 'xm', 'original');

-- CreateEnum
CREATE TYPE "NetworkEnv" AS ENUM ('local', 'cloud');

-- CreateEnum
CREATE TYPE "CreatedByRole" AS ENUM ('CUSTOMER', 'OPERATOR');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "CustomerTier" NOT NULL DEFAULT 'NORMAL',
    "boundEngineerId" TEXT,
    "firstResponseHours" INTEGER NOT NULL DEFAULT 24,
    "resolutionHours" INTEGER NOT NULL DEFAULT 72,
    "queueType" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engineer" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "level" "EngineerLevel" NOT NULL DEFAULT 'L1',
    "role" "EngineerRole" NOT NULL DEFAULT 'ENGINEER',
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engineer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByRole" "CreatedByRole" NOT NULL,
    "assignedEngineerId" TEXT,
    "engineerLevel" "EngineerLevel",
    "status" "TicketStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "platform" "Platform" NOT NULL,
    "accountInfo" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requestExample" TEXT NOT NULL,
    "contactInfo" TEXT,
    "framework" TEXT,
    "networkEnv" "NetworkEnv",
    "attachmentUrls" TEXT[],
    "slaDeadline" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeRequestedAt" TIMESTAMP(3),
    "closeRequestedBy" TEXT,
    "closeApprovedAt" TIMESTAMP(3),
    "closeApprovedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketUrge" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "urgedBy" TEXT NOT NULL,
    "urgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "TicketUrge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE INDEX "Customer_customerCode_idx" ON "Customer"("customerCode");

-- CreateIndex
CREATE INDEX "Customer_tier_idx" ON "Customer"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "Engineer_username_key" ON "Engineer"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Engineer_email_key" ON "Engineer"("email");

-- CreateIndex
CREATE INDEX "Engineer_level_isAvailable_idx" ON "Engineer"("level", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_username_key" ON "Operator"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_email_key" ON "Operator"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");

-- CreateIndex
CREATE INDEX "Ticket_customerId_idx" ON "Ticket"("customerId");

-- CreateIndex
CREATE INDEX "Ticket_assignedEngineerId_idx" ON "Ticket"("assignedEngineerId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE INDEX "Ticket_slaDeadline_idx" ON "Ticket"("slaDeadline");

-- CreateIndex
CREATE INDEX "TicketUrge_ticketId_idx" ON "TicketUrge"("ticketId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_boundEngineerId_fkey" FOREIGN KEY ("boundEngineerId") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedEngineerId_fkey" FOREIGN KEY ("assignedEngineerId") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketUrge" ADD CONSTRAINT "TicketUrge_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
