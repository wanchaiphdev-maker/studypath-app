import { ADMIN_NAME_RE, CHATTER_FIRST_RE, CASUAL_CHATTER_RE, isGenericTitle } from "../filters/classroom-filters";

/**
 * หัวข้อสำหรับสอบ — สแกนจากเนื้อหาที่เรียนจริง + งานที่นักเรียนส่งจริง
 *
 * ทำไมต้องมี:
 *  - หัวข้อกว้างๆ แบบ "Finite Automata / Graph / Tree" ไม่ได้มาจากหลักสูตรจริงเสมอ
 *    บางวิชาอาจไม่มี และบางวิชาต้องมี
 *  - ตัวเลือกต้องมาจาก "สิ่งที่เห็นในไฟล์จริง" ไม่ใช่เดาจากชื่อวิชา
 *
 * วิธีทำงาน:
 *  1. สแกนคำในเอกสาร + งานที่ส่ง -> นับความถี่ -> ได้หัวข้อที่ "มีจริง"
 *  2. ให้ AI ตรวจอีกชั้น: ตัดที่ไม่เกี่ยว และเติมหัวข้อเฉพาะวิชาที่หัวข้อสำเร็จไม่ครอบคลุม
 *  3. เรียงตามลำดับปกติของการเรียน (พื้นฐาน -> โครงสร้าง -> ทดสอบ)
 */

export type TopicDomain = "programming" | "any" | "language" | "social" | "digital" | "office";

export type CatalogTopic = {
  k: string;
  label: string;
  /** กลุ่มสำหรับจัดลำดับและแสดงผล */
  group: "พื้นฐาน" | "โครงสร้าง" | "ทดสอบ" | "ทั่วไป";
  hint: string;
  domain: TopicDomain;
  /** คำที่บ่งบอกว่าเนื้อหานี้พูดถึงหัวข้อนี้ */
  words: string[];
};

/**
 * ลำดับในอาร์เรย์นี้คือลำดับที่ "เรียนแบบปกติ"
 * ตัวที่มาก่อน = พื้นฐานกว่า เอามาเรียงต่อกันตามลำดับ
 */
export const TOPIC_CATALOG: CatalogTopic[] = [
  /* ---------- การเขียนโปรแกรมพื้นฐาน ---------- */
  {
    k: "code", label: "การเขียนโปรแกรม / โค้ด", group: "พื้นฐาน", hint: "เขียนโค้ดให้ทำงานได้จริง",
    domain: "programming",
    words: ["เขียนโปรแกรม", "เขียนโค้ด", "โปรแกรม", "coding", "programming", "โค้ด", "source code", "ชุดคำสั่ง", "คำสั่ง", "ฟังก์ชัน", "function"],
  },
  {
    k: "printf", label: "แสดงผลด้วย printf", group: "พื้นฐาน", hint: "สั่งงานให้โปรแกรมแสดงผล",
    domain: "programming",
    words: ["printf", "แสดงผล", "output", "พิมพ์ผล", "cout", "print"],
  },
  {
    k: "scanf", label: "รับค่าด้วย scanf", group: "พื้นฐาน", hint: "รับค่าจากผู้ใช้เข้าโปรแกรม",
    domain: "programming",
    words: ["scanf", "รับค่า", "input", "อ่านค่า", "ข้อมูลเข้า", "cin", "prompt"],
  },
  {
    k: "ipo", label: "โครงสร้าง Input-Process-Output", group: "พื้นฐาน", hint: "รับค่า → ประมวลผล → แสดงผล",
    domain: "programming",
    words: ["input-process-output", "input process output", "รับข้อมูล ประมวลผล แสดงผล", "ขั้นตอนการทำงานของโปรแกรม", "ipo"],
  },

  /* ---------- โครงสร้างการควบคุม ---------- */
  {
    k: "sequence", label: "โครงสร้างตามลำดับ", group: "โครงสร้าง", hint: "ทำตามลำดับบนลงล่าง",
    domain: "programming",
    words: ["sequence", "โครงสร้างตามลำดับ", "ตามลำดับ", "ลำดับการทำงาน", "sequential"],
  },
  {
    k: "if_1", label: "ทางเลือก 1 ทาง", group: "โครงสร้าง", hint: "if — ทำเมื่อเงื่อนไขเป็นจริง",
    domain: "programming",
    words: ["if statement", "if-else", "if else", "เงื่อนไข", "conditional", "ถ้า", "1 ทางเลือก", "ทางเดียว", "single branch"],
  },
  {
    k: "if_2", label: "ทางเลือก 2 ทาง", group: "โครงสร้าง", hint: "if-else — เลือกอย่างใดอย่างหนึ่ง",
    domain: "programming",
    words: ["2 ทางเลือก", "สองทาง", "if-else", "two way", "binary choice", "ถ้า...ไม่เช่นนั้น", "อื่น"],
  },
  {
    k: "if_3", label: "ทางเลือก 3 ทางขึ้นไป", group: "โครงสร้าง", hint: "else-if / switch — เลือกได้หลายทาง",
    domain: "programming",
    words: ["3 ทางเลือก", "หลายทาง", "switch", "else if", "elseif", "nested if", "หลายทางเลือก"],
  },
  {
    k: "loop", label: "โครงสร้างแบบวนซ้ำ", group: "โครงสร้าง", hint: "for / while — ทำซ้ำตามเงื่อนไข",
    domain: "programming",
    words: ["loop", "วนซ้ำ", "for loop", "while loop", "do while", "การทำซ้ำ", "iteration", "ลูป"],
  },
  {
    k: "data_struct", label: "โครงสร้างข้อมูล", group: "โครงสร้าง", hint: "array / list / tree / graph",
    domain: "programming",
    words: ["โครงสร้างข้อมูล", "data structure", "array", "อาร์เรย์", "linked list", "stack", "queue", "tree", "graph", "ชาด", "สแต็ก", "คิว"],
  },

  /* ---------- การทดสอบและอธิบาย (ทุกวิชา) ---------- */
  {
    k: "test_table", label: "ตารางทดสอบ", group: "ทดสอบ", hint: "ทำตารางยืนยันว่าโปรแกรมถูกต้อง",
    domain: "any",
    words: ["ตารางทดสอบ", "test case", "testcase", "กรณีทดสอบ", "ตัวอย่างการทดสอบ", "testing", "trace"],
  },

  /* ---------- ภาษา / สังคม / สำนักงาน (ใช้ตอน AI ใช้ไม่ได้) ----------
     TOPIC_CATALOG เดิมเอียงสายคอมฯ วิชาอังกฤษ/กฎหมาย/สำนักงานจะได้หัวข้อแปลกๆ
     เพิ่มหัวข้อกลางๆ ที่ใช้ได้ทุกวิชาสายนี้ไว้ท้น จะได้ไม่เหลือหัวข้อแค่ 1-2 อันตอน AI ล่ม */
  {
    k: "vocab", label: "คำศัพท์และนิยาม", group: "พื้นฐาน", hint: "ศัพท์สำคัญที่ต้องรู้",
    domain: "language",
    words: ["vocabulary", "คำศัพท์", "ศัพท์", "นิยาม", "ความหมาย", "term", "glossary", "lexis"],
  },
  {
    k: "grammar", label: "ไวยากรณ์และโครงสร้างประโยค", group: "พื้นฐาน", hint: "หลักการประกอบประโยคให้ถูกต้อง",
    domain: "language",
    words: ["grammar", "ไวยากรณ์", "ประโยค", "sentence", "tense", "โครงสร้างภาษา", "syntax"],
  },
  {
    k: "reading", label: "ทักษะการอ่านและการตีความ", group: "ทั่วไป", hint: "อ่านจับใจความและตีความเนื้อหา",
    domain: "language",
    words: ["reading", "อ่าน", "ตีความ", "comprehension", "สรุปเนื้อหา", "summar"],
  },
  {
    k: "law_rule", label: "กฎ/มาตราและหลักการใช้", group: "ทั่วไป", hint: "กฎเกณฑ์ที่ต้องท่องและใช้ตัดสินใจ",
    domain: "social",
    words: ["กฎหมาย", "พระราชบัญญัติ", "มาตรา", "กฎเกณฑ์", "ข้อกำหนด", "หลักการ", "จริยธรรม", "จรรยาบรรณ", "law", "regulation"],
  },
  {
    k: "digital_literacy", label: "ทักษะดิจิทัลและการใช้เครื่องมือ", group: "พื้นฐาน", hint: "ใช้เครื่องมือดิจิทัลเป็นอย่างไรให้เกิดประโยชน์",
    domain: "digital",
    words: ["ดิจิทัล", "เทคโนโลยี", "แอป", "เว็บ", "อินเทอร์เน็ต", "ข้อมูล", "ความปลอดภัย", "digital", "technology", "privacy"],
  },
  {
    k: "office_tool", label: "การใช้โปรแกรมสำนักงาน", group: "พื้นฐาน", hint: "สร้างเอกสาร/ตาราง/นำเสนอให้ถูกต้อง",
    domain: "office",
    words: ["สำนักงาน", "ออฟฟิศ", "word", "excel", "powerpoint", "sheet", "docs", "เอกสาร", "ตาราง", "นำเสนอ"],
  },
  {
    k: "flowchart", label: "Flowchart / ผังงาน", group: "ทดสอบ", hint: "เขียนเป็นผังไหลลำดับ",
    domain: "any",
    words: ["flowchart", "ผังงาน", "ผังภาพอัลกอริทึม", "flow chart", "algorithmic flowchart"],
  },
  {
    k: "pseudocode", label: "รหัสเทียม", group: "ทดสอบ", hint: "เขียนขั้นตอนเป็นภาษากลางก่อนลงมือเขียนจริง",
    domain: "any",
    words: ["รหัสเทียม", "pseudocode", "pseudo code", "รหัสจำลอง", "อธิบายขั้นตอน"],
  },
  {
    k: "algorithm", label: "อัลกอริทึม / วิธีแก้ปัญหา", group: "ทดสอบ", hint: "คิดเป็นขั้นก่อนลงมือเขียน",
    domain: "any",
    words: ["อัลกอริทึม", "algorithm", "วิธีแก้ปัญหา", "การออกแบบอัลกอริทึม", "ออกแบบวิธี", "วิธีการ", "ขั้นตอนการแก้ปัญหา"],
  },

  /* ---------- วิธีคิดที่ใช้ได้ทุกวิชา ---------- */
  {
    k: "comparison", label: "ตารางเปรียบเทียบ", group: "ทั่วไป", hint: "เทียบแตกต่างระหว่างสองสิ่ง",
    domain: "any",
    words: ["เปรียบเทียบ", "ข้อดีข้อเสีย", "เหมือนกัน", "ต่างกัน", "compare", "pros and cons", "จุดต่าง"],
  },
  {
    k: "diagram", label: "แผนภาพ / ผังโครงสร้าง", group: "ทั่วไป", hint: "วาดความสัมพันธ์ให้เห็นภาพ",
    domain: "any",
    words: ["แผนภาพ", "ผังภาพ", "โครงสร้างของ", "แผนผัง", "diagram", "แผนที่", "ความสัมพันธ์"],
  },
  {
    k: "definition", label: "นิยามและแนวคิดหลัก", group: "ทั่วไป", hint: "ตั้งนิยาม แยกแยะ เปรียบเทียบ",
    domain: "any",
    words: ["นิยาม", "ความหมาย", "แนวคิด", "หลักการ", "ความรู้", "theory", "definition", "concept"],
  },
];

export const GROUP_ORDER: Record<string, number> = { "พื้นฐาน": 0, "โครงสร้าง": 1, "ทดสอบ": 2, "ทั่วไป": 3 };

export type ScannedTopic = {
  k: string;
  label: string;
  group: string;
  hint: string;
  score: number;
  hits: number;
  sources: { title: string; count: number }[];
};

/* ------------------------------------------------------------------ */
/*  จัดเข้ากลุ่มสาขาวิชา — ใช้ตัดหัวข้อที่ "ไม่เกี่ยว" ออก                        */
/* ------------------------------------------------------------------ */

// หางชื่อวิชาที่มหาวิทยาลัยติดทุกวิชา ต้องตัดออกก่อนมองว่าเป็นวิชาอะไร
export const SUBJECT_SUFFIXES = [
  "สำหรับวิทยาการคอมพิวเตอร์", "สำหรับวิทยาการคอมพิวเตอร์และสารสนเทศ", "for computer science",
  "วิทยาการคอมพิวเตอร์และสารสนเทศ", "เพื่อการศึกษา",
];

// เรียงตามความเฉพาะเจาะจง — ต้องเช็คสาขาเฉพาะก่อนสาขากว้าง
const SUBJECT_TAGS: { tag: string; words: string[] }[] = [
  { tag: "programming", words: ["การเขียนโปรแกรม", "วิธีการโปรแกรม", "การแก้ปัญหา", "โปรแกรมประยุกต์", "ซอฟต์แวร์", "ฐานข้อมูล", "เครือข่าย", "สถาปัตยกรรม", "ระบบคอมพิวเตอร์", "อัลกอริทึม", "โครงสร้างข้อมูล", "programming", "software", "database", "algorithm"] },
  { tag: "math", words: ["คณิตศาสตร์", "สถิติ", "แคลกูลัส", "math", "statistics", "probability", "เชิงคณิตศาสตร์"] },
  { tag: "science", words: ["เคมี", "ชีววิทยา", "ฟิสิกส์", "วิทยาศาสตร์", "เภสัชศาสตร์", "แพทยศาสตร์", "วิศวกรรม", "เกษตรศาสตร์"] },
  { tag: "social", words: ["กฎหมาย", "รัฐศาสตร์", "สังคม", "จริยธรรม", "ศิลปะ", "ประวัติ", "ภูมิศาสตร์", "เศรษฐศาสตร์", "บริหาร", "การจัดการ", "จิตวิทยา", "law", "social", "ethics", "history", "art", "econom"] },
  { tag: "language", words: ["อังกฤษ", "ภาษาไทย", "ภาษา", "grammar", "ศัพท์", "สื่อสาร", "ธุรกิจ", "บัญชี", "english", "linguistic"] },
];

/**
 * คำที่ "ดูดวง" เป็นสายคอมฯ แต่จริงๆ ไม่ใช่
 * เช่น "โปรแกรมประยุกต์สำหรับสำนักงานดิจิทัล" = MS Office ไม่ใช่การเขียนโค้ด
 * ต้องเช็คก่อน SUBJECT_TAGS เสมอ ไม่งั้นจะได้ tag=programming แล้วขึ้นปุ่ม "โค้ด" ในวิชาที่ไม่ใช่สาย
 */
const SUBJECT_OVERRIDES: { tag: string; words: string[] }[] = [
  { tag: "office", words: ["สำหรับสำนักงาน", "ออฟฟิศ", "โปรแกรมประยุกต์สำหรับ", "office", "word processor", "spreadsheet", "powerpoint", "presentation"] },
  { tag: "digital", words: ["ทักษะและชีวิตดิจิทัล", "ชีวิตดิจิทัล", "ทักษะดิจิทัล", "การเปลี่ยนแปลงระบบ", "ดิจิทัลไทย"] },
];

export function detectSubjectTag(subjectName: string): string {
  let low = String(subjectName || "").toLowerCase();
  for (const s of SUBJECT_SUFFIXES) low = low.split(s).join(" ");
  for (const t of SUBJECT_OVERRIDES) if (t.words.some((w) => low.includes(w))) return t.tag;
  for (const t of SUBJECT_TAGS) if (t.words.some((w) => low.includes(w))) return t.tag;
  return "general";
}

/**
 * ตัดหัวข้อที่ไม่เกี่ยวกับวิชานั้นออก
 *
 * ปัญหาจริง: คำไทยทั่วไปอย่าง "รับค่า" "ถ้า" "คำสั่ง" โผล่ในเอกสารทุกวิชา
 * ถ้าไม่กรอง วิชาสังคมฯ จะได้หัวข้อ "scanf / if" ซึ่งไม่มีความหมาย
 *
 * กติกา: หัวข้อสายโปรแกรมจะอยู่ได้ก็ต่อเมื่อ
 *  - วิชาเป็นสายคอมพิวเตอร์ หรือ
 *  - หลักฐานแรงมาก (โค้ดยาวจริง ไม่ใช่แค่คำที่เผลอโผล่)
 */
export function gateBySubject(subjects: { k: string; domain: TopicDomain }[], subjectName: string, scanned: ScannedTopic[]): ScannedTopic[] {
  const tag = detectSubjectTag(subjectName);
  const isProgramming = tag === "programming";
  const isMathOrScience = tag === "math" || tag === "science";
  return scanned.filter((t) => {
    const spec = subjects.find((s) => s.k === t.k);
    if (!spec) return true;
    if (spec.domain === "any") return true;
    // หัวข้อเฉพาะสาย (ภาษา/กฎหมาย/ดิจิทัล/สำนักงาน) ผ่านเฉพาะวิชาที่ตรงสายนั้น
    if (spec.domain === "language") return tag === "language";
    if (spec.domain === "social") return tag === "social";
    if (spec.domain === "digital") return tag === "digital";
    if (spec.domain === "office") return tag === "office" || tag === "digital";
    if (isProgramming) return true;
    // วิชาอื่น: ต้องมีหลักฐานแรงมากถึงจะเก็บหัวข้อสายโปรแกรม
    const strong = isMathOrScience ? 18 : 25;
    return t.score >= strong;
  });
}
/**
 * สแกนเนื้อหาทั้งหมดแล้วให้คะแนนหัวข้อ
 * - นับจากเอกสารประกอบการเรียน
 * - นับจากงานที่นักเรียนส่ง (หนักกว่า เพราะคือสิ่งที่เขาต้องใช้จริง)
 */
export function scanTopics(sources: { title: string; text: string; kind: "material" | "submission" }[]): ScannedTopic[] {
  const found = new Map<string, ScannedTopic>();

  for (const src of sources) {
    const text = String(src.text || "").toLowerCase();
    if (text.length < 20) continue;
    for (const topic of TOPIC_CATALOG) {
      let count = 0;
      for (const w of topic.words) {
        const needle = w.toLowerCase();
        let idx = 0;
        while ((idx = text.indexOf(needle, idx)) > -1) { count++; idx += needle.length; }
      }
      if (!count) continue;

      const prev = found.get(topic.k);
      const weight = src.kind === "submission" ? 2 : 1;
      if (prev) {
        prev.score += count * weight;
        prev.hits += count;
        const hit = prev.sources.find((s) => s.title === src.title);
        if (hit) hit.count += count;
        else if (prev.sources.length < 3) prev.sources.push({ title: src.title, count });
      } else {
        found.set(topic.k, {
          k: topic.k, label: topic.label, group: topic.group, hint: topic.hint,
          score: count * weight, hits: count,
          sources: [{ title: src.title, count }],
        });
      }
    }
  }

  // เก็บเฉพาะหัวข้อที่เจอจริงในเนื้อหา แล้วเรียงตามลำดับการเรียน
  return [...found.values()]
    .filter((t) => t.score >= 2)
    .sort((a, b) => (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9) || b.score - a.score);
}

/** ทำให้คำค้นหาแคบลง ไม่ให้จับคำที่ไม่เกี่ยวกัน */
export function normalizeForScan(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^฀-๿a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  ให้ AI ตัดสินอีกชั้น — เพราะการนับคำไม่รู้ว่าอะไร "คือหัวข้อจริง" ของวิชา  */
/* ------------------------------------------------------------------ */

export type FinalTopic = {
  k: string;
  label: string;
  group: string;
  hint: string;
  why: string;
  fromCatalog: boolean;
  score?: number;
};

const CATALOG_FOR_AI = TOPIC_CATALOG.map((t) => `${t.k} | ${t.label} | กลุ่ม:${t.group}`).join("\n");

/**
 * คำสั่งให้ AI: ได้หัวข้อที่สแกนเจอเป็น "เบาะแส" แล้วให้ตัดสินใจสุดท้ายว่าวิชานี้สอนอะไรจริง
 * - หัวข้อในแคตตาล็อกที่เข้าข่าย ให้ใช้ key เดิม
 * - หัวข้อเฉพาะวิชาที่ไม่มีในแคตตาล็อก ให้เพิ่มเองได้
 * - ห้ามใส่หัวข้อที่ไม่มีในเอกสาร
 */
/**
 * บังคับตัดหัวข้อสายโปรแกรมออกจากวิชาที่ไม่ใช่สายคอมฯ
 *
 * ทำไมต้องมีชั้นนี้: prompt บอก AI อยู่แล้วว่าห้ามใส่หัวข้อโปรแกรมในวิชาอื่น
 * แต่ AI ยังคืนคีย์แคตตาล็อกสายคอมฯ กลับมา (โดยเฉพาะตอน 429/503 ที่ AI ไม่ได้ช่วย)
 * → ต้องมีตัวกรองฝั่งเซิร์ฟเวอร์ ไม่งั้นวิชาทักษะดิจิทัลจะได้ "แสดงผลด้วย printf"
 */
export function stripProgrammingTopics(topics: any[], subjectName: string) {
  const tag = detectSubjectTag(subjectName);
  if (tag === "programming" || tag === "math" || tag === "science") return topics;
  const codingKeys = new Set(
    TOPIC_CATALOG.filter((t) => t.domain === "programming").map((t) => t.k)
  );
  // หัวข้อที่ AI แต่งเองไม่มีคีย์ → ตัดด้วยการดูคำเตือนในชื่อ
  const looksCoding = /(printf|scanf|\bC\+\+\b|เขียนโค้ด|เขียนโปรแกรม|ฟังก์ชัน|อาร์เรย์|ลูป|loop|recursive|โครงสร้างข้อมูล|อัลกอริทึม|โปรแกรมพื้นฐาน)/i;
  return topics.filter((t: any) => {
    const k = String(t.key || t.k || "");
    if (k && codingKeys.has(k)) return false;
    const label = String(t.label || t.title || "");
    if (looksCoding.test(label)) return false;
    return true;
  });
}

export function buildTopicPrompt(subjectName: string, scanned: ScannedTopic[], content: string) {
  const hints = scanned.length
    ? scanned.map((t) => `- ${t.k} (${t.label}) คะแนน ${t.score} จาก: ${t.sources.map((s) => s.title.slice(0, 40)).join(", ")}`).join("\n")
    : "(การนับคำไม่เจออะไรเลย — ให้ดูเนื้อหาด้วยตัวเอง)";

  return [
    {
      role: "system",
      content:
        "คุณคือผู้ช่วยวิเคราะห์หลักสูตรจากเอกสารประกอบการเรียนจริง\n\n" +
        "หัวข้อมาตรฐานที่ระบบรู้จัก:\n" + CATALOG_FOR_AI + "\n\n" +
        "กติกา:\n" +
        "1. เลือกหัวข้อที่วิชานี้สอนจริง เท่านั้น ถ้าไม่เจอในเนื้อหาห้ามใส่\n" +
        "2. ถ้าหัวข้ออยู่ในรายการมาตรฐาน ให้ใช้ key ตามนั้น\n" +
        "3. ถ้าวิชานี้มีหัวข้อสำคัญที่ไม่มีในรายการ (เช่น กฎหมาย บท มาตรา) ให้เพิ่มขึ้นใหม่ได้ ใช้ key เป็นภาษาอังกฤษสั้นๆ\n" +
        "4. หัวข้อโปรแกรม (printf/scanf/if/loop ฯลฯ) ให้ใส่เฉพาะวิชาสายคอมพิวเตอร์เท่านั้น\n" +
        "5. เรียงลำดับตามลำดับการเรียนจริง (พื้นฐาน -> ทฤษฎี -> การนำไปใช้)\n" +
        "6. จำนวน 4-12 หัวข้อ\n\n" +
        'ตอบเป็น JSON เท่านั้น: {"topics":[{"key":"...","label":"...","group":"พื้นฐาน|โครงสร้าง|ทดสอบ|ทั่วไป","why":"เจอเพราะอะไร 1 ประโยค"}]}\n' +
        "ห้ามมีคำอธิบายนอก JSON",
    },
    {
      role: "user",
      content:
        "วิชา: " + subjectName +
        "\n\nหัวข้อที่ระบบนับคำเจอ (ใช้เป็นเบาะแส ไม่ใช่คำตอบสุดท้าย):\n" + hints +
        "\n\nเนื้อหาในวิชา:\n" + content,
    },
  ];
}

/** รวมผลสแกน + ผล AI ให้เป็นรายการหัวข้อที่พร้อมใช้ */
export function mergeTopics(scanned: ScannedTopic[] | any[] | null | undefined, aiTopics: any[] | null): FinalTopic[] {
  const base: any[] = Array.isArray(scanned) ? scanned : [];
  const byKey = new Map(base.map((t: any) => [t.k, t]));
  const out: FinalTopic[] = [];
  const seen = new Set<string>();

  for (const t of aiTopics || []) {
    const key = String(t.key || t.k || "").trim();
    const label = String(t.label || "").trim();
    if (!label) continue;
    const norm = label.toLowerCase().replace(/\s+/g, "");
    if (seen.has(norm)) continue;
    seen.add(norm);
    const hit = byKey.get(key);
    out.push({
      k: key || label,
      label,
      group: String(t.group || hit?.group || "ทั่วไป"),
      hint: hit?.hint || "",
      why: String(t.why || "").slice(0, 200),
      fromCatalog: !!(hit || TOPIC_CATALOG.some((c) => c.k === key)),
      score: hit?.score,
    });
  }

  // หัวข้อที่สแกนเจอแต่ AI ไม่ได้เลือก -> ไม่เอา (ตามที่ผู้ใช้สั่ง "ไม่เกี่ยวก็คัดออก")
  // แต่ถ้า AI ใช้ไม่ได้ ให้ใช้ผลสแกนล้วนแทน
  if (!out.length) {
    for (const t of base) {
      out.push({ k: t.k, label: t.label, group: t.group || "ทั่วไป", hint: t.hint || "", why: (t.sources || []).map((s: any) => String(s.title || "").slice(0, 40)).join(", "), fromCatalog: true, score: t.score });
    }
  }

  return out.sort((a, b) => (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9));
}
/**
 * ดึงหัวข้อจาก "ชื่อไฟล์จริง" โดยไม่ต้องพึ่ง AI
 * ใช้ตอน AI ใช้ไม่ได้ (429 / โควตาเต็ม / 500) เพราะ TOPIC_CATALOG เอียงสายคอมฯ
 * วิชาอื่นเช่น ทักษะดิจิทัล/อังกฤษ จะได้หัวข้อว่างไปเฉย ๆ ถ้าพึ่ง AI อย่างเดียว
 */
export function topicsFromTitles(sources: { title: string | null; kind?: string }[]): ScannedTopic[] {
  const freq = new Map<string, { label: string; score: number; hits: number; sources: { title: string; count: number }[] }>();

  for (const src of sources) {
    // ชื่อที่เป็นงานธุระจัดการไม่ใช่หัวข้อเรียน — ห้ามกลายเป็นหัวข้อ
    // เช่น "Quiz I (5%)", "Link Online 14-08-69", "เอกสารประกอบการเรียน"
    if (ADMIN_NAME_RE.test(String(src.title || "")) || CHATTER_FIRST_RE.test(String(src.title || "")) || CASUAL_CHATTER_RE.test(String(src.title || ""))) continue;

    let t = String(src.title || "")
      .replace(/\.[a-z0-9]{2,5}$/i, "")        // ตัดนามสกุลไฟล์
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length < 3) continue;

    // ชื่อที่ไม่มีความหมาย เช่น "เอกสารประกอบการเรียน6", "Material-ประกอบการเรียน"
    if (isGenericTitle(t)) continue;
    // เหลือแต่คะแนน/เปอร์เซ็นต์ เช่น "Quiz I (5%)" = ข้อสอบ ไม่ใช่เนื้อหา
    if (/^quiz\s*[ivx\d]*\s*[\(\[]?\s*\d*\s*%?\s*[\)\]]?$/i.test(t)) continue;

    // ตัดคำนำหน้าที่ไม่ได้บอกเนื้อหา เช่น "01 ใบงาน...", "แบบฝึกหัด 2"
    // ต้องตัด "แบบฝึกหัดที่ N" ให้ครบ ไม่ใช่เหลือ "ที่ 2 ..."
    t = t.replace(/^(แบบทดสอบ|แบบฝึกหัด|ใบงาน|เอกสารประกอบ|เอกสารประกอบการเรียน|ใบสั่งงาน|assignment|worksheet|slide|powerpoint|รายงานเรื่อง|ประกาศ|week|chapter|lecture)\s*(ที่\s*)?/i, "");
    t = t.replace(/^WEEK\s*#?\s*\d+\s*[:.\-]?\s*/i, "");
    t = t.replace(/^Chapter\s*\d+\s*[:.\-]?\s*/i, "");
    t = t.replace(/^\d+[\s.\-]+/, "");
    t = t.replace(/^ที่\s*\d+\s*/, "").trim();
    t = t.replace(/^\d+\s*/, "").trim();
    // เหลือเป็นตัวเลข/สัญลักษณ์ล้วน = ไม่บอกหัวข้ออะไร
    if (t.length < 4 || t.length > 70) continue;
    if (/^[\W\d_]+$/.test(t)) continue;

    // ตัดส่วนท้ายที่เป็นเลขบท เช่น "บทที่ 3", "chapter 2"
    t = t.replace(/\s*(บทที่|บท|chapter|lecture|week|ครั้งที่)\s*\d+\s*$/i, "").trim();
    if (t.length < 3) continue;

    const key = t.toLowerCase();
    const weight = src.kind === "submission" ? 2 : 1;
    const prev = freq.get(key);
    if (prev) {
      prev.score += weight;
      prev.hits += 1;
      if (prev.sources.length < 3) prev.sources.push({ title: src.title as string, count: 1 });
    } else {
      freq.set(key, {
        label: t,
        score: weight,
        hits: 1,
        sources: [{ title: src.title as string, count: 1 }],
      });
    }
  }

  return [...freq.entries()]
    .filter(([, v]) => v.hits >= 1)
    .sort((a, b) => b[1].score - a[1].score || b[1].hits - a[1].hits)
    .slice(0, 12)
    .map(([k, v]) => ({
      k,
      label: v.label,
      group: "จากชื่อไฟล์",
      hint: "",
      score: v.score,
      hits: v.hits,
      sources: v.sources,
    }));
}
/**
 * ประกาศในห้องเรียน / โพสต์ของนักเรียน ไม่ใช่ "เนื้อหาวิชา"
 * Google Classroom sync เก็บมาทั้งหมด ทำให้การหาหัวข้อเพี้ยน
 * (เช่นวิชาอังกฤษที่มีแต่ประกาศ กลายเป็นหัวข้อ "ห้องขายหนังสือ", "ขออนุญาตลา")
 * หมายเหตุ: กรองเฉพาะตอนหาหัวข้อ ไม่ลบข้อมูลออกจากฐาน
 */
export function looksLikeAnnouncement(title: string): boolean {
  const s = String(title || "").trim();
  if (!s) return true;
  if (/^\d{10}\b/.test(s)) return true;                                     // 69010310559 นางสาว...
  if (/^(FYI|สวัสดี|ขออนุญาต|ขออภัย|ขอบคุณ|เรียนอาจาร์ย|อาจารย์คะ|อาจารย์ครับ|รบกวน|หมายเหตุ)/i.test(s)) return true;
  if (/(แจ้งเตือน|ประกาศ|ประกาศนัด|announcement|community chat|กดเข้า|กลุ่ม\s*\d|การสอบ(กลาง|ย่อย|ปลาย))/i.test(s)) return true;
  if (s.length > 110) return true;                                          // ข้อความยาว = โพสต์นักเรียน
  if (/\p{Extended_Pictographic}/u.test(s) && s.length < 90) return true;  // อีโมจิแบบประกาศ
  return false;
}
