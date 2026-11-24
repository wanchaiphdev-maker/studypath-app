/**
 * เติมเวกเตอร์ (embedding) ให้ chunk ทั้งหมดที่ยังไม่มี — ใช้เมื่อติดตั้งครั้งแรกหรือหลังซิงก์เนื้อหาจำนวนมาก
 *
 *   cd backend
 *   npx ts-node scripts/backfill-embeddings.ts
 *
 * หมายเหตุ: free tier ของ Google จำกัด ~100 ข้อความ/นาที สคริปต์จะรอตามที่ผู้ให้บริการแจ้ง
 * (เนื้อหา 3,000 กว่า chunk ใช้เวลาราว 30-40 นาที) ระหว่างรันแอปใช้งานได้ตามปกติ
 */
import "dotenv/config";
import { backfillEmbeddings, embeddingStats } from "../src/lib/embeddings";

(async () => {
  const before = await embeddingStats();
  console.log(`เริ่ม: มีเวกเตอร์แล้ว ${before.total - before.missing}/${before.total} chunk`);
  if (!before.missing) {
    console.log("ครบแล้ว ไม่ต้องทำอะไร");
    return;
  }
  let total = 0;
  for (let round = 0; round < 200; round++) {
    const result = await backfillEmbeddings(400);
    total += result.embedded;
    console.log(`รอบ ${round + 1}: +${result.embedded} (เหลือ ${result.remaining})`);
    if (!result.embedded) break;
  }
  const after = await embeddingStats();
  console.log(`เสร็จ: เพิ่ม ${total} chunk — ตอนนี้มี ${after.total - after.missing}/${after.total}`);
})().catch((error) => {
  console.error("ล้มเหลว:", error?.message || error);
  process.exit(1);
});
