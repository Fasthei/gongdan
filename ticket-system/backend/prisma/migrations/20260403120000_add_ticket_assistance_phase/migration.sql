-- CreateEnum
CREATE TYPE "AssistancePhase" AS ENUM ('PRESALES', 'POSTSALES');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "assistancePhase" "AssistancePhase" NOT NULL DEFAULT 'POSTSALES';
