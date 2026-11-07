-- เพิ่มดัชนีไม่ซ้ำที่ schema ระบุไว้แต่ฐานข้อมูลไม่มีจริง
-- ทำให้ import ซ้ำ (เช่น ซิงก์อัตโนมัติชนกับซิงก์ด้วยมือ) ไม่สร้างระเบียนซ้ำได้
CREATE UNIQUE INDEX IF NOT EXISTS "Material_userId_externalProvider_externalId_key"
ON "Material"("userId", "externalProvider", "externalId");