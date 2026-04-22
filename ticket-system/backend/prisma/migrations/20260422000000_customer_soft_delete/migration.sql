-- AlterTable: soft delete for Customer
ALTER TABLE "Customer" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Customer_deletedAt_idx" ON "Customer"("deletedAt");
