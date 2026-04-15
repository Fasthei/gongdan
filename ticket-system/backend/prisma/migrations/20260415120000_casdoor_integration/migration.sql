-- Casdoor 集成：
-- 1. passwordHash 设为可空（Casdoor 用户不再需要本地密码）
-- 2. 新增 casdoorId 字段并建立唯一索引

ALTER TABLE "Engineer" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "Engineer" ADD COLUMN "casdoorId" TEXT;
CREATE UNIQUE INDEX "Engineer_casdoorId_key" ON "Engineer"("casdoorId");
CREATE INDEX "Engineer_casdoorId_idx" ON "Engineer"("casdoorId");

ALTER TABLE "Operator" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "Operator" ADD COLUMN "casdoorId" TEXT;
CREATE UNIQUE INDEX "Operator_casdoorId_key" ON "Operator"("casdoorId");
CREATE INDEX "Operator_casdoorId_idx" ON "Operator"("casdoorId");
