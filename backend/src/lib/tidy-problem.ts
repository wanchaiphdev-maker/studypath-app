/**
 * tidyProblem — จัดข้อความโจทย์ดิบให้อ่านง่าย โดย "ไม่แตะเนื้อหา"
 *
 * ปัญหา: ไฟล์ในห้องเรียน (PDF/สไลด์) ถูกดึงออกมาเป็นข้อความดิบ รหัสเทียมกระจายปนย่อหน้า
 * ตาราง IPO กลายเป็นบรรทัดคั่นด้วย tab อ่านยาก ไม่มีส่วน ไม่มีสี
 *
 * หน้าที่ของฟังก์ชันนี้: เปลี่ยน "รูปแบบ" ให้เป็น markdown ที่หน้าจอแสดงผลเองได้
 *   - กลุ่มรหัสเทียม (start/read/print/...)   → บล็อกโค้ด ``` (กล่องมีสี ฟอนต์ monospace)
 *   - แถวคั่นด้วย tab (ตารางจาก PDF)           → ตาราง markdown (หัวตาราง + เส้นคั่น)
 *   - หัวข้อสั้น ๆ เหนือบล็อกโค้ด              → ## หัวข้อ
 *   - บรรทัดคำสั่งท้ายสุด "จงเขียน..."         → ตัวหนา ให้เห็นชัดว่าต้องทำอะไร
 *   - บรรทัดขึ้นต้นด้วย "บรรทัดที่/ขั้นตอนที่…" → เว้นบรรทัดก่อน = ย่อหน้าใหม่
 *   - บรรทัดเลขลำดับเดี่ยว ("4.")              → ผสานกับบรรทัดถัดไปให้เป็นรายการเดียว
 *
 * ข้อจำกัดสำคัญ: ห้ามเพิ่ม ห้ามลบ ห้ามแก้คำในเนื้อหาเด็ดขาด — ทำได้เฉพาะจัดกลุ่ม/เว้นระยะ/ใส่เครื่องหมาย markdown
 */

/** คำสั่ง/ป้ายรหัสเทียม (ภาษาอังกฤษ สั้น ไม่มี ; { } = รูปแบบโค้ดจริง) */
const PSEUDO_KW =
  /^(start|stop|end|finish|read|print|display|input|output|set|call|declare|initialize|if|else|elseif|elif|then|for|while|do|repeat|until|function|procedure|return|goto)\b/i;

/** ขึ้นต้นด้วยชนิดตัวแปร/ฟังก์ชันภาษาโปรแกรม = โค้ดจริง ไม่ใช่รหัสเทียม ห้ามไปจับใส่กล่อง */
const CODE_START =
  /^(int|float|char|double|void|long|short|unsigned|signed|static|struct|include|printf|scanf|cout|cin|def|import|class|public|private)\b/i;

/** บรรทัดขึ้นต้นเหล่านี้ = เริ่มย่อหน้าใหม่ → เว้นบรรทัดก่อนให้อ่านแยกออก */
const PARA_START =
  /^(บรรทัดที่|ขั้นตอนที่|ขั้นที่|ตอนที่|ตอนแรก|ตอนท้าย|หมายเหตุ|ตัวอย่าง|ข้อที่|โจทย์\s|Note\b|Example\b|Step\s*\d|Given\b)/i;

/** บรรทัดสั่งงานท้ายโจทย์ ("จงเขียนโปรแกรม...") — ไฮไลต์เป็นตัวหนา */
const TASK_LINE = /^จง[\s\S]{2,}/;

function isPseudoLine(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length > 90) return false;
  if (/[^\x20-\x7E]/.test(t)) return false; // ต้องเป็นอักษร/สัญลักษณ์อังกฤษล้วน (มีไทย = ย่อหน้า)
  if (/[;{}#]|\/\//.test(t)) return false; // เครื่องหมายโค้ดจริง/คอมเมนต์/preprocessor
  if (CODE_START.test(t)) return false; // โค้ดภาษาโปรแกรม ไม่ใช่รหัสเทียม
  if (PSEUDO_KW.test(t)) return true;
  // การกำหนดค่าแบบรหัสเทียม: x = ... (ไม่มี ; ปิดท้าย)
  return /^[A-Za-z_]\w*\s*=[^=]/.test(t) && !/;\s*$/.test(t);
}

function isTableLine(s: string): boolean {
  return s.includes("\t");
}

/** หัวข้อที่จะเปลี่ยนเป็น ## ได้: ขึ้นต้นด้วยตัวอักษร สั้น ไม่ใช่ประโยคท้ายด้วยจุด ไม่ใช่เลขลำดับ */
function asHeading(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 70) return false;
  if (!/^[\u0E00-\u0E7FA-Za-z]/.test(t)) return false; // ต้องขึ้นต้นด้วยตัวอักษร (กันเศษข้อความเช่น "%f")
  if (/[.!?;,]$/.test(t)) return false;
  if (/^(จง|ให้|#|\d+[.)])/.test(t)) return false;
  if (isPseudoLine(t) || isTableLine(t)) return false;
  return true;
}

export function tidyProblem(src: string): string {
  const text = String(src || "");
  if (!text.trim()) return text;

  const lines = text.split(/\r?\n/);

  // ---- ผ่านที่ 1: หาดัชนีที่ต้องทำเครื่องหมายไว้ก่อน (ตรงเงื่อนไขกับผ่านที่ 2 เท่านั้น) ----
  const headingAt = new Set<number>();
  const boldAt = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!isPseudoLine(lines[i])) continue;
    // นับความยาวกลุ่มรหัสเทียมแบบเดียวกับผ่านที่ 2
    let j = i;
    let count = 0;
    while (j < lines.length) {
      if (isPseudoLine(lines[j])) { count++; j++; }
      else if (!lines[j].trim() && j + 1 < lines.length && isPseudoLine(lines[j + 1])) j++;
      else break;
    }
    if (count >= 2) {
      let k = i - 1;
      while (k >= 0 && !lines[k].trim()) k--;
      if (k >= 0 && asHeading(lines[k])) headingAt.add(k);
    }
    i = j - 1; // ข้ามกลุ่มที่นับแล้ว
  }
  // บรรทัดคำสั่งท้ายสุด (ต้องไม่ใช่บรรทัดที่ถูกจับเป็นกลุ่มโค้ด/ตาราง)
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  if (last >= 0) {
    const t = lines[last].trim();
    if (TASK_LINE.test(t) && t.length <= 250 && !t.startsWith("**") && !isPseudoLine(t) && !isTableLine(t)) boldAt.add(last);
  }
  // บรรทัดแรกของโจทย์เป็น "หัวข้อ" ("ตัวอย่างที่ 3.2 ..." / "แบบฝึกหัด ..." / "ข้อที่ 4 ...")
  // -> ทำเป็น ## ให้เห็นชัดว่าโจทย์ข้อนี้คืออะไร (เคารพเงื่อนไข asHeading เดียวกับหัวข้อเหนือบล็อกโค้ด)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const t = raw.replace(/\t+/g, "  "); // หัวข้อจาก PDF อาจคั่นด้วย tab — แทนด้วยช่องว่างก่อนตรวจ
    if (/^(ตัวอย่าง|แบบฝึกหัด|ข้อที่|โจทย์|ใบงาน)/.test(t) && asHeading(t)) {
      lines[i] = t; // ผ่านที่ 2 จะไม่เห็น tab ในบรรทัดหัวข้อแล้ว
      headingAt.add(i);
    }
    break; // ดูเฉพาะบรรทัดแรกที่มีเนื้อหาเท่านั้น
  }

  // ---- ผ่านที่ 2: จัดกลุ่มแล้วค่อยเขียนออก ----
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    // (ก) ตาราง tab
    if (isTableLine(lines[i])) {
      const rows: string[][] = [];
      let j = i;
      while (j < lines.length) {
        if (isTableLine(lines[j])) {
          rows.push(lines[j].split("\t").map((c) => c.trim()));
          j++;
        } else if (rows.length && lines[j].trim() && lines[j].trim().length <= 50 && j + 1 < lines.length && isTableLine(lines[j + 1])) {
          // PDF ตัดคำท้ายแถว (บรรทัดไม่มี tab แต่ถัดไปมี) — ต่อท้ายเซลล์สุดท้ายของแถวก่อนหน้า
          const lastRow = rows[rows.length - 1];
          lastRow[lastRow.length - 1] = (lastRow[lastRow.length - 1] + " " + lines[j].trim()).trim();
          j++;
        } else break;
      }
      if (rows.length >= 2) {
        const cols = Math.max(1, rows[0].length);
        const norm = rows.map((r) => {
          const cells = r.slice(0, cols);
          while (cells.length < cols) cells.push("");
          if (r.length > cols) {
            // เซลล์เกินจาก tab ซ้อน — รวมต่อท้ายเซลล์สุดท้าย ไม่ให้เนื้อหาย
            const tail = r.slice(cols).filter(Boolean).join(" ");
            cells[cols - 1] = [cells[cols - 1], tail].filter(Boolean).join(" ");
          }
          return cells;
        });
        out.push("");
        out.push("| " + norm[0].join(" | ") + " |");
        out.push("| " + norm[0].map(() => "---").join(" | ") + " |");
        for (const row of norm.slice(1)) out.push("| " + row.join(" | ") + " |");
        out.push("");
        i = j;
        continue;
      }
      // แถวเดียว — ไม่พอเป็นตาราง ปล่อยเป็นข้อความ (tab ถูกแทนด้วยช่องว่างด้านล่าง)
    }

    // (ข) กลุ่มรหัสเทียม → บล็อกโค้ด
    if (isPseudoLine(lines[i])) {
      let j = i;
      let count = 0;
      while (j < lines.length) {
        if (isPseudoLine(lines[j])) { count++; j++; }
        else if (!lines[j].trim() && j + 1 < lines.length && isPseudoLine(lines[j + 1])) j++; // บรรทัดว่างคั่นในกลุ่ม
        else break;
      }
      if (count >= 2) {
        out.push("");
        out.push("```");
        for (let k = i; k < j; k++) {
          const s = lines[k].trim();
          if (s) out.push(s);
        }
        out.push("```");
        out.push("");
        i = j;
        continue;
      }
      // กลุ่มสั้นเกินไป (1 บรรทัด) — ปล่อยเป็นข้อความตามเดิม
    }

    // (ค) หัวข้อเหนือบล็อกโค้ด → ##
    if (headingAt.has(i)) {
      out.push("");
      out.push("## " + lines[i].trim());
      out.push("");
      i++;
      continue;
    }

    // (ง) คำสั่งท้ายสุด → ตัวหนา
    if (boldAt.has(i)) {
      out.push("");
      out.push("**" + lines[i].trim() + "**");
      out.push("");
      i++;
      continue;
    }

    // (จ) บรรทัดเลขลำดับเดี่ยว ("4.") → ผสานกับบรรทัดถัดไป ให้เป็นรายการเดียว
    if (/^\d+[.)]\s*$/.test(lines[i].trim()) && i + 1 < lines.length && lines[i + 1].trim()
      && !headingAt.has(i + 1) && !boldAt.has(i + 1) && !isTableLine(lines[i + 1])) {
      out.push("");
      out.push(lines[i].trim().replace(/[.)]\s*$/, ". ") + lines[i + 1].trim());
      out.push("");
      i += 2;
      continue;
    }

    // (ซ) ย่อหน้าใหม่ตาม marker → เว้นบรรทัดก่อน
    if (PARA_START.test(lines[i].trim())) out.push("");

    // บรรทัดธรรมดา — tab เดี่ยวที่ไม่ใช่ตาราง แทนด้วยช่องว่างกันช่องหาย
    out.push(lines[i].replace(/\t+/g, "  "));
    i++;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
