import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, spacing } from "../../lib/theme";
import { Alert } from "../../lib/alert";
import { Button, Card, GlowCard, Pill } from "../../lib/ui";
import MermaidFlow from "../../components/MermaidFlow";
import {
  BASE_URL, getSubjects, tutorAnalyze, tutorAskStream, tutorCheckAnswer, tutorDiagnose, tutorEvaluate,
  tutorOpen, tutorPlan, tutorProblem, tutorProblemVariant, tutorStudyPlan, tutorTts, tutorTopics,
} from "../../lib/api";

/* ================================================================== */
/*  ตัวเลือกทั้งหมด — รวมไว้ที่เดียว ผู้ใช้เลือกเองได้ทุกอย่าง          */
/* ================================================================== */

type Mode = "explain" | "diagram" | "code" | "steps" | "vocab" | "grammar" | "case" | "compare" | "howto";
const MODES: { k: Mode; label: string; icon: string; hint: string; color: string }[] = [
  { k: "explain", label: "อธิบาย", icon: "school-outline", hint: "อธิบายให้เข้าใจง่าย", color: "#a78bfa" },
  { k: "diagram", label: "ผังภาพ", icon: "git-branch-outline", hint: "วาด flowchart", color: "#f472b6" },
  { k: "code", label: "โค้ด", icon: "code-slash-outline", hint: "เขียนโค้ดใช้ได้จริง", color: "#34d399" },
];
// รายการสำรองเมื่อ /open ยังไม่ตอบ — ห้ามมี "โค้ด" เพราะยังไม่มีหลักฐานว่าวิชานี้สอนเขียนโค้ด
// (โหมดโค้ดต้องมาจาก server ที่อ่านเนื้อหาไฟล์จริงแล้วเท่านั้น)
const FALLBACK_MODES = MODES.filter((m) => m.k !== "code");

type Speed = "fast" | "balanced" | "thorough";
const SPEEDS: { k: Speed; label: string; hint: string; icon: string }[] = [
  { k: "fast", label: "เร็ว", hint: "ตอบทันที 3-6 บรรทัด", icon: "flash" },
  { k: "balanced", label: "สมดุล", hint: "ครบ ชัด ไม่นาน", icon: "speedometer" },
  { k: "thorough", label: "ละเอียด", hint: "อธิบายเต็มที่ พร้อมตัวอย่าง", icon: "infinite" },
];

type Level = "normal" | "high" | "deep";
const LEVELS: { k: Level; label: string; hint: string; color: string }[] = [
  { k: "normal", label: "ปกติ", hint: "พื้นฐาน", color: "#34d399" },
  { k: "high", label: "สูง", hint: "เจาะละเอียด", color: "#f59e0b" },
  { k: "deep", label: "เจาะลึก", hint: "ขั้นสูง", color: "#f43f5e" },
];

/* ================================================================== */
/*  ตัวแก้โค้ด — เขียนเองได้จริง ย่อตัวอัตโนมัติ เหมือนในโปรแกรม            */
/* ================================================================== */


/**
 * รวมตัวเลือกที่ซ้ำกันให้เหลือตัวเดียว (ชั้นกันพลาดบน client)
 * เทียบแบบไม่สนตัวพิมพ์ ช่องว่าง และเครื่องหมายท้าย
 */
/** ตัดตัวเลือกซ้ำ — ใช้ได้ทั้ง "ข้อสอบ" (options เป็น string) และ "โจทย์" (options เป็น {text, correct})
 *  เดิมทำ String(raw) กับ object จนข้อความหาย (เหลือ "A. " เปล่า ๆ) เลยคง item ตั้งต้นไว้
 *  แล้วใช้แค่ค่า text ในการเทียบซ้ำ */
function uniqueOptions<T>(options: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const raw of options) {
    const text = String((typeof raw === "string" ? raw : (raw as any)?.text) ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ").replace(/\s*([,;:])\s*/g, "$1").replace(/[.,;:!?)\]]+$/g, "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}
const CodeInput = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => {
  const ref = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const timers = useRef<any[]>([]);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [pos, setPos] = useState({ line: 1, col: 1 });
  const lines = value.split("\n").length;
  const parts = useMemo(() => (value ? highlight(value, guessLang(value)) : []), [value]);

  /** บอกตำแหน่งเคอร์เซอร์ — ช่วงตัวอักษรใสทำให้มองไม่เห็นว่าพิมตรงไหน */
  const syncPos = () => {
    const el: any = ref.current;
    if (!el) return;
    const i = typeof el.selectionStart === "number" ? el.selectionStart : 0;
    const before = String(el.value ?? "").slice(0, i);
    const line = before.split("\n").length;
    const col = i - (before.lastIndexOf("\n") + 1) + 1;
    setPos((p) => (p.line === line && p.col === col ? p : { line, col }));
  };

  /** เลื่อนชั้นสีให้ตรงกับช่องพิมเสมอ — ไม่งั้นโค้ดยาวๆจะเลื่อนไม่ตรงกัน */
  const syncScroll = (e?: any) => {
    // อ่านค่าจาก event เท่านั้น — การอ่าน scrollTop จาก ref บน RNW ได้ค่าที่ไม่ตรงเสมอ
    // ผลคือชั้นสีไม่ขยับตาม = ผู้ใช้เลื่อนแล้วเห็นกรอบเปล่า
    const off0 = e?.nativeEvent?.contentOffset ?? e?.target;
    const y = Number(off0?.y ?? off0?.scrollTop ?? 0) || 0;
    const x = Number(off0?.x ?? off0?.scrollLeft ?? 0) || 0;
    setOff((p) => (p.x === x && p.y === y ? p : { x, y }));
    const box: any = layerRef.current;
    if (box && box.style) box.style.transform = `translate(${-x}px, ${-y}px)`;
  };

  const jumpTo = (where: "top" | "bottom") => {
    const input: any = ref.current;
    if (!input) return;
    const max = Math.max(0, (input.scrollHeight || 0) - (input.clientHeight || 300));
    const y = where === "bottom" ? max : 0;
    input.scrollTop = y;
    input.scrollLeft = 0;
    // ส่งค่าให้ชั้นสีโดยตรง ไม่รอให้ onScroll ปาดมา (บางครั้งไม่ยิงตอนกำหนดค่าเอง)
    syncScroll({ nativeEvent: { contentOffset: { x: 0, y } } });
  };
  // ย่อบรรทัดอัตโนมัติ + Tab = 4 ช่องว่าง (เฉพาะเว็บ ที่เข้าถึง DOM ได้)
  useEffect(() => {
    const el: any = ref.current;
    if (!el || !el.addEventListener) return;
    const onKey = (ev: any) => {
      const cur: string = el.value ?? "";
      const start: number = el.selectionStart ?? cur.length;
      const end: number = el.selectionEnd ?? cur.length;

      if (ev.key === "Tab") {
        ev.preventDefault();
        const next = cur.slice(0, start) + "    " + cur.slice(end);
        onChange(next);
        requestAnimationFrame(() => el.setSelectionRange(start + 4, start + 4));
        return;
      }
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        const lineStart = cur.lastIndexOf("\n", start - 1) + 1;
        const line = cur.slice(lineStart, start);
        const indent = (line.match(/^[ \t]*/) || [""])[0];
        const extra = /:\s*$/.test(line) ? "    " : "";
        const ins = "\n" + indent + extra;
        const next = cur.slice(0, start) + ins + cur.slice(end);
        onChange(next);
        const pos = start + ins.length;
        requestAnimationFrame(() => el.setSelectionRange(pos, pos));
      }
    };
    el.addEventListener("keydown", onKey);
    ["keyup", "click", "select", "focus", "input"].forEach((ev) => el.addEventListener(ev, syncPos));
    syncPos();
    return () => {
      el.removeEventListener("keydown", onKey);
      ["keyup", "click", "select", "focus", "input"].forEach((ev) => el.removeEventListener(ev, syncPos));
    };
  }, [value, onChange]);

  // เพิ่งได้โค้ดยาว (เช่นกด "ให้อาจารย์ช่วยร่าง") → เลื่อนไปท้ายสุดให้เห็นทันที
  useEffect(() => {
    if (!value) { syncScroll({ nativeEvent: { contentOffset: { x: 0, y: 0 } } }); return; }
    // layout ยังไม่เสร็จตอน rAF แรก -> ลองอีก 2 รอบ แล้วค่อยตัดสินว่าเนื้อหาล้นหรือไม่
    const t1 = setTimeout(() => {
      const input: any = ref.current;
      if (!input) return;
      if (input.scrollHeight > input.clientHeight) jumpTo("bottom");
      else syncScroll({ nativeEvent: { contentOffset: { x: 0, y: 0 } } });
      timers.current.push(setTimeout(() => {
        const el: any = ref.current;
        if (el && el.scrollHeight > el.clientHeight) jumpTo("bottom");
      }, 200));
    }, 100);
    timers.current.push(t1);
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
  }, [value]);

  return <View style={styles.editor}>
    <View style={styles.editorBar}>
      <Text style={styles.editorLang}>โค้ดของคุณ</Text>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        {value ? <Text style={styles.editorPos}>บรรทัด {pos.line} · คอลัมน์ {pos.col}</Text> : null}
        <Text style={styles.editorMeta}>{lines} บรรทัด</Text>
        {value ? <Pressable onPress={() => jumpTo("top")} style={styles.editorJump}><Text style={styles.editorJumpText}>ขึ้นบนสุด</Text></Pressable> : null}
        {value ? <Pressable onPress={() => jumpTo("bottom")} style={styles.editorJump}><Text style={styles.editorJumpText}>ลงล่างสุด</Text></Pressable> : null}
      </View>
    </View>

    <View style={styles.editorWrap}>
      {/* ชั้นที่ 1: สีสด — เลื่อนตามช่องพิม */}
      <View ref={layerRef} style={[styles.editorLayer, { transform: [{ translateX: -off.x }, { translateY: -off.y }] }]} pointerEvents="none">
        <Text style={[styles.editorText, styles.editorLayerText, codeTextStyle]}>
          {parts.map((p, i) => <Text key={i} style={[codeSpanStyle, { color: p.c }]}>{p.t}</Text>)}
          {"\n"}
        </Text>
      </View>

      {/* ชั้นที่ 2: ช่องพิม ตัวอักษรใส */}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChange}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        placeholder={placeholder || "พิมพ์โค้ดของคุณ..."}
        placeholderTextColor={colors.textMuted}
        onScroll={(e) => syncScroll(e)}
        selectionColor="#7c3aed"
        // ตัวอักษรใสเพื่อให้ชั้นสีข้างบนทับ ต้องกำหนดสีเคอร์เซอร์เอง
        // ไม่งั้นเคอร์เซอร์จะกลายเป็น currentColor = ใส = มองไม่เห็นว่าพิมตรงไหน
        style={[styles.editorText, codeTextStyle, styles.editorInput, { caretColor: "#f0abfc" }]}
      />
    </View>
  </View>;
};

/** เดาภาษาจากตัวโค้ด เพื่อให้สีตรงกับภาษา */
function guessLang(code: string): string {
  const c = code.toLowerCase();
  if (/\b(def|print|input|elif|None|True)\b/.test(c)) return "python";
  if (/\b(console|function|const|let|var|=>)\b/.test(c)) return "javascript";
  if (/#include|printf\(|int main|scanf/.test(c)) return "c";
  if (/\b(System\.|public class|Scanner)\b/.test(c)) return "java";
  if (/\b(SELECT|FROM|WHERE|INSERT|UPDATE)\b/i.test(c)) return "sql";
  if (/\b(echo|fi|done|then)\b/.test(c)) return "bash";
  if (/<[a-z][\s\S]*>/i.test(c)) return "html";
  return "javascript";
}

/* รูปแบบคำตอบของระบบข้อสอบ — เลือกได้ทุกข้อ */
type Fmt = "text" | "options" | "code" | "flowchart" | "diagram" | "table";
const FORMATS: { k: Fmt; label: string; icon: string; hint: string }[] = [
  { k: "text", label: "ข้อความ", icon: "document-text-outline", hint: "ตอบเป็นข้อความ" },
  { k: "options", label: "ตัวเลือก", icon: "list-outline", hint: "A B C ง" },
  { k: "code", label: "โค้ด", icon: "code-slash-outline", hint: "เขียนเป็นโปรแกรม" },
  { k: "flowchart", label: "ผังภาพ", icon: "git-branch-outline", hint: "flowchart" },
  { k: "diagram", label: "แผนผัง", icon: "grid-outline", hint: "ผังงาน/โครงสร้าง" },
  { k: "table", label: "ตาราง", icon: "grid-outline", hint: "เทียบข้อมูล" },
];

type Tab = "chat" | "plan" | "diag";
const TABS: { k: Tab; label: string; icon: string }[] = [
  { k: "chat", label: "ถาม–ตอบ", icon: "chatbubbles-outline" },
  { k: "plan", label: "แผนการเรียน", icon: "map-outline" },
  { k: "diag", label: "ข้อสอบ", icon: "checkbox-outline" },
];

/* ================================================================== */
/*  ตัวแสดงผลคำตอบ: โค้ด / ผังภาพ / ข้อความ ไม่ให้เพี้ยน            */
/* ================================================================== */

// อักขระวาดกล่อง/ลูกศร/สามเหลี่ยม ที่ใช้ใน flowchart และผังงาน
const BOX_CHARS = /[─-╿▀-◿←-⇿∀-⋿▲-▶◀-◿]/;

function looksLikeDiagram(s: string) {
  const lines = s.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const boxed = lines.filter((l) => BOX_CHARS.test(l)).length;
  const wide = lines.filter((l) => l.length > 20).length;
  return boxed >= 2 && boxed / lines.length >= 0.6 && wide / lines.length >= 0.5;
}

/** บรรทัดนี้เป็นส่วนหนึ่งของผังภาพไหม */
function isDiagramLine(l: string) {
  return BOX_CHARS.test(l) || /^[\s]*[▼▲◀▶→←↑↓+|]{2,}/.test(l) || /^[\s]*[┌└├┤┬┴┼─│┐┘]/.test(l);
}

type Block = { kind: "text" | "code" | "diagram" | "mermaid"; content: string; lang?: string };

/* ================================================================== */
/*  Syntax highlighting — ทำให้โค้ดดูเหมือนในโปรแกรมจริง                   */
/* ================================================================== */

const CODE_COLORS = {
  plain: "#e6edf7",
  keyword: "#ff7b72",
  string: "#a5d6ff",
  number: "#79c0ff",
  comment: "#7d8590",
  func: "#d2a8ff",
  type: "#7ee787",
  op: "#ff9e64",
  tag: "#7ee787",
  attr: "#79c0ff",
};

const KW: Record<string, string[]> = {
  python: ["def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import", "from", "class", "try", "except", "finally", "with", "as", "pass", "break", "continue", "lambda", "None", "True", "False", "yield", "global", "assert", "del", "is", "async", "await"],
  js: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "class", "extends", "import", "export", "default", "from", "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "null", "undefined", "true", "false", "async", "await", "this", "delete", "void", "yield"],
  c: ["int", "float", "double", "char", "void", "long", "short", "unsigned", "struct", "typedef", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "const", "static", "include", "define", "NULL", "true", "false", "sizeof"],
  java: ["public", "private", "protected", "class", "static", "final", "void", "int", "double", "float", "char", "boolean", "long", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "import", "package", "extends", "implements", "this", "super", "try", "catch", "finally", "throw", "null", "true", "false", "interface", "abstract"],
  sql: ["SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "DROP", "ALTER", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "AS", "AND", "OR", "NOT", "NULL", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX"],
  bash: ["if", "then", "else", "fi", "for", "in", "do", "done", "while", "case", "esac", "function", "return", "echo", "export", "local", "exit", "cd", "ls", "sudo", "npm", "node", "git"],
  go: ["func", "return", "if", "else", "for", "range", "switch", "case", "break", "continue", "var", "const", "type", "struct", "interface", "package", "import", "nil", "true", "false", "defer", "go", "chan", "map"],
};
KW.ts = KW.js; KW.typescript = KW.js; KW.jsx = KW.js; KW.tsx = KW.js; KW.cpp = KW.c; KW["c++"] = KW.c; KW.h = KW.c; KW.cs = KW.java; KW.csharp = KW.java; KW.php = KW.js; KW.ruby = KW.js; KW.swift = KW.java; KW.kt = KW.java; KW.kotlin = KW.java; KW.dart = KW.java;
KW.sh = KW.bash; KW.shell = KW.bash; KW.zsh = KW.bash; KW.json = []; KW.html = []; KW.css = []; KW.r = ["function", "return", "if", "else", "for", "while", "in", "library", "require", "TRUE", "FALSE", "NULL", "c", "print"];

const TYPES: Record<string, string[]> = {
  python: ["int", "float", "str", "bool", "list", "dict", "set", "tuple", "print", "len", "range", "sum", "input", "append", "sorted", "enumerate", "zip", "min", "max", "abs"],
  js: ["String", "Number", "Boolean", "Array", "Object", "Math", "JSON", "Date", "console", "parseInt", "parseFloat", "String"],
  c: ["printf", "scanf", "malloc", "sizeof", "strlen", "strcpy"],
  java: ["String", "Integer", "Double", "Boolean", "System", "Math", "ArrayList", "Scanner"],
  sql: ["NOW", "COUNT", "SUM", "AVG"],
};

/** ตัดโค้ดเป็นชิ้นที่มีสี ตามภาษา */
function highlight(code: string, lang: string): { t: string; c: string }[] {
  const L = (lang || "").toLowerCase();
  const kw = KW[L] || KW.js;
  const ty = TYPES[L] || TYPES.js;
  const out: { t: string; c: string }[] = [];

  // แบ่งตามบรรทัด แล้วหาชิ้นสำคัญในแต่ละบรรทัด
  const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b|([{}()[\];,]|[+\-*/%=<>!&|^~?:.]+)/g;
  const push = (t: string, c: string) => { if (t) out.push({ t, c }); };

  if (L === "html" || L === "xml") {
    const parts = code.split(/(<\/?[A-Za-z][^>]*>)/g);
    for (const p of parts) {
      if (!p) continue;
      if (/^<\/?[A-Za-z]/.test(p)) {
        push(p.replace(/^<\/?/, "").split(/[\s>/]/)[0], CODE_COLORS.tag);
        push(p.replace(/^<\/?[A-Za-z][\w-]*/, "<").replace(/\/?>$/, ">"), CODE_COLORS.op);
      } else push(p, CODE_COLORS.plain);
    }
    return out;
  }

  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(code))) {
    // ช่องว่าง/การขึ้นบรรทัดระหว่างชิ้นที่จับได้ — ต้องเก็บไว้เสมอ ไม่งั้นบรรทัดจะหาย
    if (m.index > last) push(code.slice(last, m.index), CODE_COLORS.plain);
    last = re.lastIndex;

    if (m[1]) { push(m[1], CODE_COLORS.comment); continue; }
    if (m[2]) { push(m[2], CODE_COLORS.string); continue; }
    if (m[3]) { push(m[3], CODE_COLORS.number); continue; }
    if (m[4]) {
      const w = m[4];
      if (kw.indexOf(w) > -1 || kw.indexOf(w.toLowerCase()) > -1) push(w, CODE_COLORS.keyword);
      else if (ty.indexOf(w) > -1) push(w, CODE_COLORS.type);
      else if (code[re.lastIndex] === "(") push(w, CODE_COLORS.func);
      else push(w, CODE_COLORS.plain);
      continue;
    }
    if (m[5]) { push(m[5], CODE_COLORS.op); continue; }
  }
  if (last < code.length) push(code.slice(last), CODE_COLORS.plain);
  return out;
}

const CodeBlock = ({ code, lang }: { code: string; lang: string }) => {
  const parts = useMemo(() => highlight(code, lang), [code, lang]);
  return <View style={styles.codeBox}>
    <View style={styles.codeHead}>
      <View style={styles.codeDots}><View style={[styles.dot, { backgroundColor: "#ff5f57" }]} /><View style={[styles.dot, { backgroundColor: "#febc2e" }]} /><View style={[styles.dot, { backgroundColor: "#28c840" }]} /></View>
      <Text style={styles.codeLang}>{lang || "code"}</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Text style={codeTextStyle}>
        {parts.map((p, i) => <Text key={i} style={[codeSpanStyle, { color: p.c }]}>{p.t}</Text>)}
      </Text>
    </ScrollView>
  </View>;
};

const LANGS = ["python", "py", "javascript", "js", "ts", "typescript", "jsx", "tsx", "java", "c", "cpp", "c++", "cs", "csharp", "go", "rust", "php", "ruby", "sql", "html", "css", "json", "bash", "shell", "sh", "r", "kotlin", "swift", "dart"];

function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  const fences = String(text).split(/```/);
  fences.forEach((seg, i) => {
    if (i % 2 === 1) {
      const nl = seg.indexOf("\n");
      const raw = (nl >= 0 ? seg.slice(0, nl) : seg).trim();
      const body = (nl >= 0 ? seg.slice(nl + 1) : seg).replace(/\n$/, "");
      // ```mermaid = flowchart ที่ต้องวาดเป็นรูป ไม่ใช่โค้ดธรรมดา
      if (/^mermaid$/i.test(raw)) { out.push({ kind: "mermaid", content: body }); return; }
      const lang = LANGS.includes(raw.toLowerCase()) ? raw : "";
      out.push({ kind: "code", content: body, lang });
      return;
    }
    // เก็บบรรทัดต่อเนื่องที่เป็นชนิดเดียวกันไว้ด้วยกัน (สำคัญมาก ถ้าแยกทีละบรรทัดจะตรวจจับผังภาพไม่ได้)
    let buf: string[] = [];
    let bufIsDiagram = false;
    const flush = () => {
      if (!buf.length) return;
      const block = buf.join("\n");
      if (bufIsDiagram && looksLikeDiagram(block)) out.push({ kind: "diagram", content: block });
      else out.push({ kind: "text", content: block });
      buf = [];
    };
    for (const line of seg.split("\n")) {
      const d = isDiagramLine(line);
      if (buf.length && d !== bufIsDiagram) flush();
      bufIsDiagram = d;
      buf.push(line);
    }
    flush();
  });
  return out.filter((b) => b.kind !== "text" || b.content.trim().length > 0);
}

// ฟอนต์สำหรับข้อความที่ต้องจัดวางตรงหลัก (โค้ด / flowchart) — ใช้ space ไม่ตัดบรรทัด
const MONO: any = { fontFamily: "Consolas, Menlo, Monaco, 'Courier New', monospace" };
const codeTextStyle: any = { ...MONO, color: "#e6edf7", fontSize: 12.5, lineHeight: 20, whiteSpace: "pre", padding: 12, paddingTop: 10 };
// แต่ละชิ้นที่มีสีต้องมี whiteSpace เองด้วย ไม่งั้น RNW จะยุบช่องว่างทิ้งจนบรรทัดหาย
const codeSpanStyle: any = { whiteSpace: "pre" };

// whiteSpace:"pre" อยู่นอก StyleSheet เพราะ `as any` ข้างในจะทำให้ชนิดของ StyleSheet.create เพี้ยน
const editorTextStyle: any = {
  ...MONO,
  color: "#e6edf7", fontSize: 12.5, lineHeight: 20, whiteSpace: "pre",
  padding: 12, textAlignVertical: "top", width: "100%",
};
const diagramTextStyle: any = { ...MONO, color: "#e9d5ff", fontSize: 11, lineHeight: 16, whiteSpace: "pre", padding: 12 };

/** แปลง markdown ระดับบรรทัด: **หนา**, *เอียง*, `โค้ด`, หัวข้อ #, bullet, เลข, checkbox */
const Inline = ({ s, tone }: { s: string; tone?: "dark" | "light" }) => {
  const dark = tone === "dark";
  const parts = String(s).split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\$[^$\n]+\$)/g).filter((x) => x !== "");
  return <>{parts.map((p, i) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <Text key={i} style={[styles.mdBold, dark && { color: "#0f172a" }]}>{p.slice(2, -2)}</Text>;
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return <Text key={i} style={[styles.mdCode, dark && { backgroundColor: "#e2e8f0", color: "#1d4ed8" }]}>{p.slice(1, -1)}</Text>;
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <Text key={i} style={[styles.mdItalic, dark && { color: "#475569" }]}>{p.slice(1, -1)}</Text>;
    // $x$ ที่โมเดลใช้แทนตัวแปร — แสดงเป็นโค้ดแทนเครื่องหมาย $
    if (p.length > 3 && p.startsWith("$") && p.endsWith("$")) return <Text key={i} style={[styles.mdCode, dark && { backgroundColor: "#e2e8f0", color: "#1d4ed8" }]}>{p.slice(1, -1)}</Text>;
    return <Text key={i}>{p}</Text>;
  })}</>;
};

/** ตาราง markdown — โจทย์หลายข้อมีตารางทดสอบ ต้องอ่านออกง่าย */
const MdTable = ({ rows }: { rows: string[][] }) => {
  const head = rows[0];
  const body = rows.slice(1);
  const cols = head.length;
  const flex = Array.from({ length: cols }, (_, c) => {
    const lens = [head[c] || "", ...body.map((r) => r[c] || "")].map((s) => s.length);
    const max = Math.max(...lens);
    return max > 12 ? 1.6 : 1;
  });
  const total = flex.reduce((a, b) => a + b, 0);
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableWrap}>
    <View style={styles.table}>
      <View style={[styles.tr, styles.thead]}>
        {head.map((h, c) => <View key={c} style={{ flex: flex[c], minWidth: 54 }}><Text style={styles.th} numberOfLines={3}>{h}</Text></View>)}
      </View>
      {body.map((r, ri) => <View key={ri} style={[styles.tr, ri % 2 ? styles.trAlt : null]}>
        {r.map((cell, c) => <View key={c} style={{ flex: flex[c], minWidth: 54 }}><Text style={styles.td} numberOfLines={3}>{cell}</Text></View>)}
      </View>)}
      <View style={{ height: 0, width: total * 0 }} />
    </View>
  </ScrollView>;
};

/** แยกบรรทัดตารางออกจากข้อความ (| a | b |) */
function grabTable(lines: string[], start: number): string[][] | null {
  if (!/^\s*\|.*\|\s*$/.test(lines[start] || "")) return null;
  const rows: string[][] = [];
  let i = start;
  while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] || "")) {
    const cells = lines[i].trim().slice(1, -1).split("|").map((s) => s.trim());
    // ข้ามแถวเส้นคั่น |---|---|
    if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) rows.push(cells);
    i++;
  }
  return rows.length >= 2 ? rows : null;
}

const MdText = ({ text, tone }: { text: string; tone?: "dark" | "light" }) => {
  const dark = tone === "dark";
  const T = dark ? styles.mdTextPaper : styles.mdText;
  const lines = String(text).split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const table = grabTable(lines, i);
    if (table) {
      out.push(<View key={i} style={{ marginVertical: 8 }}><MdTable rows={table} /></View>);
      i = table.length ? lines.length - 1 : i;
      // ข้ามบรรทัดตารางทั้งกลุ่ม
      let j = i;
      while (j + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[j + 1] || "")) j++;
      i = j;
      continue;
    }
    if (!t) { out.push(<View key={i} style={{ height: 8 }} />); continue; }
    const h = t.match(/^(#{1,4})\s*(.*)$/);
    if (h) { out.push(<Text key={i} style={[styles.mdHead, { fontSize: 17 - h[1].length }, dark && { color: "#0f172a" }]}><Inline s={h[2]} tone={tone} /></Text>); continue; }
    const box = t.match(/^[-*•]\s*\[( |x|X)\]\s*(.*)$/);
    if (box) { out.push(<View key={i} style={styles.mdBulletRow}>
      <Text style={styles.mdBox}>{box[1].toLowerCase() === "x" ? "☑" : "☐"}</Text>
      <Text style={[T, { flex: 1 }]}><Inline s={box[2]} tone={tone} /></Text>
    </View>); continue; }
    const b = t.match(/^[-*•]\s+(.*)$/);
    if (b) { out.push(<View key={i} style={styles.mdBulletRow}>
      <Text style={[styles.mdDot, dark && { color: "#2563eb" }]}>•</Text>
      <Text style={[T, { flex: 1 }]}><Inline s={b[1]} tone={tone} /></Text>
    </View>); continue; }
    const n = t.match(/^(\d+)[.)]\s+(.*)$/);
    if (n) { out.push(<View key={i} style={styles.mdBulletRow}>
      <Text style={[styles.mdNum, dark && { color: "#2563eb" }]}>{n[1]}.</Text>
      <Text style={[T, { flex: 1 }]}><Inline s={n[2]} tone={tone} /></Text>
    </View>); continue; }
    out.push(<Text key={i} style={T}><Inline s={t} tone={tone} /></Text>);
  }
  return <View>{out}</View>;
};

const RichText = ({ text, streaming, tone }: { text: string; streaming?: boolean; tone?: "dark" | "light" }) => {
  const blocks = parseBlocks(text);
  return <View>
    {blocks.map((b, i) => {
      const prev = blocks[i - 1];
      const afterCode = prev && (prev.kind === "code" || prev.kind === "diagram");
      if (b.kind === "text") return <View key={i} style={[styles.block, { marginTop: i ? 12 : 0 }, afterCode && styles.afterCode]}>
        <MdText text={b.content} tone={tone} />
      </View>;
      if (b.kind === "code") return <CodeBlock key={i} code={b.content} lang={b.lang || ""} />;
      if (b.kind === "mermaid") return <MermaidFlow key={i} code={b.content} />;
      return <View key={i} style={styles.diagramBox}>
        <View style={styles.diagramHead}>
          <Text style={styles.diagramTag}>ผังภาพ</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={diagramTextStyle}>{b.content}</Text>
        </ScrollView>
      </View>;
    })}
    {streaming ? <Text style={styles.cursor}>▍</Text> : null}
  </View>;
};

/* ================================================================== */
/*  เสียงพูด: เสียงจริงจาก Gemini ถ้าไม่ได้ใช้เสียงเบราว์เซอร์แทน        */
/* ================================================================== */

let current: any = null;
const voiceCache = new Map<string, string>();

/** ตัดส่วนที่อ่านออกเสียงไม่ได้ออก เหลือแต่ข้อความภาษาไทย/อังกฤษ */
function spokenText(raw: string) {
  return String(raw)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[─-╿▀-◿←-⇿∀-⋿]/g, " ")
    .replace(/[`*_#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

async function speak(text: string) {
  const w: any = typeof window !== "undefined" ? window : null;
  const clean = spokenText(text);
  if (!w || !clean) return;
  const key = clean.slice(0, 160);
  const cached = voiceCache.get(key);
  if (cached && w.Audio) {
    const a = new Audio(`${BASE_URL}${cached}`);
    await a.play().catch(() => fallbackSpeak(w, clean));
    current = a;
    return;
  }
  try {
    const r: any = await tutorTts(clean);
    if (!r?.url) throw new Error("ไม่ได้รับลิงก์เสียง");
    voiceCache.set(key, r.url);
    if (w.Audio) {
      stopSpeak();
      const a = new Audio(`${BASE_URL}${r.url}`);
      await a.play();
      current = a;
      return;
    }
    throw new Error("เล่นเสียงไม่ได้");
  } catch {
    fallbackSpeak(w, clean);
  }
}

function fallbackSpeak(w: any, clean: string) {
  if (!w?.speechSynthesis) return;
  w.speechSynthesis.cancel();
  const u = new w.SpeechSynthesisUtterance(
    clean.replace(/[#*`>_|]/g, " ").replace(/\n{2,}/g, ". ").replace(/\n/g, ". ").slice(0, 1200)
  );
  u.lang = "th-TH";
  u.rate = 0.95;
  w.speechSynthesis.speak(u);
}

function stopSpeak() {
  const w: any = typeof window !== "undefined" ? window : null;
  if (current) { try { current.pause(); } catch { } current = null; }
  if (w?.speechSynthesis) w.speechSynthesis.cancel();
}

/* ================================================================== */

type Msg = { role: "me" | "ai"; text: string; sources?: any[]; usedModel?: boolean; grounded?: boolean; streaming?: boolean };

export default function Tutor() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [optOpen, setOptOpen] = useState(false);
  const [q, setQ] = useState("");

  const [mode, setMode] = useState<Mode>("explain");
  const [speed, setSpeed] = useState<Speed>("balanced");
  const [level, setLevel] = useState<Level>("normal");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [tab, setTab] = useState<"chat" | "plan" | "diag">("chat");

  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  const [plan, setPlan] = useState<any>(null);
  const [planBusy, setPlanBusy] = useState(false);

  const [quiz, setQuiz] = useState<any>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [quizBusy, setQuizBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [syllabus, setSyllabus] = useState<any>(null);
  const [sylBusy, setSylBusy] = useState(false);
  const [sylFor, setSylFor] = useState("");

  /** ดึงหัวข้อของวิชาจากเนื้อหาจริง + งานที่ส่ง (เปลี่ยนวิชาแล้วต้องดึงใหม่) */
  useEffect(() => {
    if (!subjectId || sylFor === subjectId) return;
    let alive = true;
    setSylBusy(true);
    setSyllabus(null);
    tutorTopics(subjectId)
      .then((r: any) => { if (alive) { setSyllabus(r); setSylFor(subjectId); } })
      .catch(() => { if (alive) { setSyllabus({ topics: [] }); setSylFor(subjectId); } })
      .finally(() => { if (alive) setSylBusy(false); });
    return () => { alive = false; };
  }, [subjectId]);

  /* --- ระบบข้อสอบ: ดึงโจทย์จริงจากในวิชา + เลือกรูปแบบคำตอบ --- */
  // รูปแบบคำตอบไม่ให้ผู้ใช้เลือกเองแล้ว (ซ้ำกับโหมดในเมนู) ให้เซร์ฟเวอร์เลือกตามโจทย์
  const [problem, setProblem] = useState<any>(null);
  const [probBusy, setProbBusy] = useState(false);
  const [probErr, setProbErr] = useState("");
  const [myAnswer, setMyAnswer] = useState("");
  const [picked, setPicked] = useState(-1);
  const [mark, setMark] = useState<any>(null);
  const [markBusy, setMarkBusy] = useState(false);
  // ใบ้ทีละบรรทัด — เลือกแบบ "insert เป็นโครงโค้ดให้แก้ต่อ":
  // ใบ้ถูกใส่ลงในช่องโค้ด (myAnswer) จริง เป็นโครงให้ผู้เรียนแก้/พิมพ์ต่อเอง
  // เก็บเฉลยรวมไว้ใน hintLines แล้วปลดล็อกใส่ทีละบรรทัดตอนติด
  const [hintLines, setHintLines] = useState<string[]>([]);
  const [hintShown, setHintShown] = useState(0);
  const [hintBusy, setHintBusy] = useState(false);
  // วิเคราะห์โจทย์ (Input/Output/Process/ตัวแปร/ค่าเริ่มต้น/รหัสเทียม) — แยกจากตัวโจทย์
  // ผู้เรียนกดปุ่มเองตอนอยากดูแนวทาง โจทย์จะไม่มีส่วนวิเคราะห์ปนอยู่เด็ดขาด
  type Analysis = { input: string[]; output: string[]; process: string[]; variables: string[]; initial: string[]; pseudocode: string };
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [doneItems, setDoneItems] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [zoom, setZoom] = useState(false);
  const [src, setSrc] = useState<"class" | "submission">("class");
  // หน้าเลือกก่อนดึงโจทย์ — กด "ดึงโจทย์" แล้วขึ้นมาให้เลือก "แนวไหน + หัวข้อไหน" ก่อนสุ่มจริง
  const [pickStage, setPickStage] = useState(false);
  // แนวโจทย์ที่เลือกในหน้าเลือก — "เก็บไว้เฉพาะรอบดึงนี้" ห้ามผูกกับโหมดหลัก (mode)
  // เพราะเปลี่ยนโหมดหลัก = เปลี่ยนทั้งหน้าจอ (แชต/เมนู/โจทย์อัตโนมัติ) ตามที่ผู้ใช้สั่งห้าม
  // "" = ทั่วไป (ระบบเลือกฟอร์แมตเอง), "code" = โค้ด, "options" = หลายตัวเลือก
  const [pullStyle, setPullStyle] = useState<string>("");

  const fmt: Fmt = ((problem?.format as Fmt) || "text") as Fmt;
  const fmtMeta = FORMATS.find((f) => f.k === fmt) || FORMATS[0];
  /**
   * ใบ้แบบ "insert เป็นโครงโค้ด" — เฉลยถูกสอดเข้าไปในช่องโค้ด (myAnswer) จริง
   * ทีละบรรทัด ผู้เรียนแก้/พิมพ์ต่อเองได้ทุกบรรทัด
   * AI ช่วยแค่ปลดล็อกทีละบรรทัดตอนติด ไม่ใช่เททั้งก้อนในครั้งเดียว
   */
  /** สอดบรรทัดใบ้ต่อท้ายช่องโค้ด (ทีละบรรทัดหรือทั้งก้อน) */
  function insertHintLines(lines: string[]) {
    if (!lines.length) return;
    setMyAnswer((prev) => {
      // ตัดเฉพาะช่องว่างท้ายบรรทัด (space/tab) — ห้ามตัด \n เพราะจะกลืนบรรทัดว่างของใบ้ทิ้ง
      const base = prev.replace(/[ \t]+$/, "");
      const add = lines.join("\n");
      return base ? base + "\n" + add : add;
    });
  }
  async function fetchHints() {
    if (!problem) return;
    setHintBusy(true);
    let acc = "";
    // ตัด ``` รอบโค้ดแบบหลวม ๆ ใช้ระหว่าง stream เพราะหมวกปิดอาจยังมาไม่ครบ
    const stripLoose = (t: string) =>
      t.replace(/^\s*`{1,3}[a-zA-Z]*\r?\n?/, "").replace(/\s*`{1,3}\s*$/, "");
    // ตัดคอมเมนต์ท้ายโค้ดที่ไม่ใช่ส่วนของโปรแกรมจริง (ทักทาย / ถามว่าอยากให้เพิ่มอะไร)
    // ตัดเฉพาะ "หลังโค้ด" เท่านั้น — คอมเมนต์inlineระหว่างบรรทัดคงไว้
    const trimTail = (code: string) => {
      const lines = code.replace(/\s+$/, "").split("\n");
      const isCmt = (l: string) => /^\s*(#|\/\/|\/\*|\*|--)/.test(l);
      while (lines.length && isCmt(lines[lines.length - 1])) lines.pop();
      const out = lines.join("\n");
      return out.trim() ? out : code.replace(/\s+$/, "");
    };
    // หาตำแหน่งเริ่มคอมเมนต์ในบรรทัด โดยข้าม // และ # ที่อยู่ในเครื่องหมายคำพูด
    // # ถือเป็นคอมเม้นต์ก็ต่อเมื่อตามด้วยช่องว่าง (กัน #include/#define ของ C++ ถูกตัดผิด)
    const findCmtStart = (line: string): number => {
      let inS = false, inD = false;
      for (let i = 0; i < line.length - 1; i++) {
        const ch = line[i];
        if (ch === "'" && !inD) inS = !inS;
        else if (ch === '"' && !inS) inD = !inD;
        else if (!inS && !inD) {
          if (ch === "/" && line[i + 1] === "/") return i;
          if (ch === "#" && (line[i + 1] === " " || line[i + 1] === "\t")) return i;
        }
      }
      return -1;
    };
    // ดึงคอมเมนต์ออกจากบรรทัดโค้ด แล้วเอาไปไว้ "ต่อท้ายโค้ด" รวมกัน
    // โค้ดจะโล่งไม่มี // ขวาง ส่วนคำอธิบาย(คอมเมนต์)ไปรวมกันท้ายสุดแทน
    const relocateComments = (raw: string[]): string[] => {
      const code: string[] = [];
      const cmts: string[] = [];
      for (const line of raw) {
        const at = findCmtStart(line);
        if (at < 0) { code.push(line); continue; }
        const head = line.slice(0, at).replace(/[ \t]+$/, "");
        const cmt = line.slice(at).trim();
        if (head.trim()) code.push(head); // ยังมีโค้ดก่อนคอมเมนต์ -> เก็บเฉพาะส่วนโค้ด
        if (cmt) cmts.push(cmt);          // ส่วนคอมเมนต์ -> ไปไว้ท้าย
      }
      if (!cmts.length) return raw;
      // ตัดบรรทัดว่างซ้อน ๆ ที่อาจเหลือจากการเอาคอมเมนต์ออก
      const out: string[] = [];
      for (const l of code) {
        if (!l.trim() && out.length && !out[out.length - 1].trim()) continue;
        out.push(l);
      }
      while (out.length && !out[out.length - 1].trim()) out.pop();
      return [...out, "", ...cmts];
    };
    // ใบ้โผล่ใต้ช่องพิมพ์ ถ้าไม่เลื่อนหน้าจอมา ผู้เรียนจะไม่เห็นว่าใบ้มาแล้ว
    setTimeout(() => {
      const box: any = answerRef.current;
      if (!box || !box.measureInWindow) return;
      box.measureInWindow((_x: number, y: number) => {
        // y คือตำแหน่งบนจอ ต้องบวกส่วนที่เลื่อนไปแล้วเพื่อได้ตำแหน่งจริงในเนื้อหา
        scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + y - 90), animated: true });
      });
    }, 120);
    try {
      await tutorAskStream(
        subjectId,
        "เขียนโค้ดแก้โจทย์นี้ ตอบเป็นโค้ดเท่านั้นในกล่อง ``` ห้ามมีคำอธิบายใด ๆ นอกกล่อง และห้ามพิมพ์ข้อความทักทาย ถามท้ายคำตอบ หรือสรุปความยาวเหตุผล ให้มีแต่โค้ดล้วน คอมเมนต์ในโค้ดใส่เฉพาะบรรทัดที่จำเป็นจริง ๆ เท่านั้น",
        "normal", "code", "balanced",
        {
          onDelta: (t) => { acc += t; },
          // เสร็จแล้วเก็บ "ทั้งก้อน" ไว้ใน hintLines แล้วสอด "บรรทัดแรก" เข้าช่องโค้ดก่อน
          // ที่เหลือค่อยกดปลดล็อกทีละบรรทัด
          onDone: () => {
            const m = acc.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
            const clean = m ? m[1] : acc;
            // ดึง // ออกจากบรรทัดโค้ด แล้วไปรวมกันไว้ต่อท้ายโค้ด
            const lines = relocateComments(trimTail(stripLoose(clean)).split("\n"));
            if (!lines.join("").trim()) { Alert2("ยังร่างไม่ได้", "AI ไม่ส่งโค้ดกลับมา ลองอีกครั้ง"); return; }
            setHintLines(lines);
            setHintShown(1); // สอดเข้าช่องแค่บรรทัดแรกก่อน ที่เหลือต้องกดปลดล็อกเอง
            insertHintLines([lines[0]]);
          },
          onError: (e) => Alert2("ยังร่างไม่ได้", e),
        }
      );
    } catch (e: any) {
      Alert2("ยังร่างไม่ได้", String(e?.message || e));
    } finally { setHintBusy(false); }
  }
  /** ปลดล็อกใบ้ถัดไป — สอดอีกหนึ่งบรรทัดเข้าช่องโค้ด ผู้เรียนแก้/ต่อเอง */
  function moreHint() {
    if (hintShown >= hintLines.length) return;
    insertHintLines([hintLines[hintShown]]);
    setHintShown((n) => Math.min(n + 1, hintLines.length));
  }
  /** ยอมแพ้ดูเฉลย — สอดทุกบรรทัดที่เหลือเข้าช่องโค้ดทั้งหมด */
  function revealAllHints() {
    const rest = hintLines.slice(hintShown);
    insertHintLines(rest);
    setHintShown(hintLines.length);
  }
  /** เคลียร์ใบ้เมื่อสุ่มโจทย์ใหม่ (ช่องโค้ดก็ถูกล้างโดย loadProblem/loadVariant อยู่แล้ว) */
  function resetHints() { setHintLines([]); setHintShown(0); }

  /** เคลียร์บทวิเคราะห์เมื่อเปลี่ยนโจทย์ (โจทย์ใหม่ = บทวิเคราะห์เก่าใช้ไม่ได้) */
  function resetAnalysis() { setAnalysis(null); setAnalysisOpen(false); }

  /** กดปุ่ม "วิเคราะห์โจทย์" — ยังไม่มีก็ดึง, มีแล้วก็เปิด/ซ่อน */
  async function toggleAnalysis() {
    if (analysisBusy || !problem) return;
    if (analysis) { setAnalysisOpen((o) => !o); return; }
    setAnalysisBusy(true);
    try {
      const r: Analysis = await tutorAnalyze(subjectId, problem.problem);
      setAnalysis(r);
      setAnalysisOpen(true);
    } catch (e: any) {
      Alert2("วิเคราะห์โจทย์ไม่สำเร็จ", String(e?.message || e).replace(/^Error:\s*/, ""));
    } finally { setAnalysisBusy(false); }
  }

  /** แสดงหัวข้อหนึ่งของบทวิเคราะห์ (ข้ามถ้าไม่มีรายการ) */
  function analysisSection(title: string, items: string[]) {
    if (!items?.length) return null;
    return (
      <View key={title} style={{ marginTop: 10 }}>
        <Text style={styles.analysisH}>{title}</Text>
        {items.map((it, i) => (
          <View key={i} style={styles.analysisRow}>
            <Text style={styles.analysisDot}>•</Text>
            <Text style={styles.analysisItem}>{it}</Text>
          </View>
        ))}
      </View>
    );
  }

  async function loadProblem(forceFmt?: string) {
    if (needSubject()) return;
    setProbBusy(true); setProbErr(""); setMark(null); setMyAnswer(""); setPicked(-1); setDoneItems([]); setMissing([]); resetHints(); resetAnalysis();
    try {
      // แนวโจทย์จากหน้าเลือก (pullStyle) มาก่อน — เลือกที่นี่มีผลเฉพาะรอบดึงนี้ ไม่เปลี่ยนโหมดหลัก
      // ไม่ได้เลือก = ค่อยดูโหมดหลัก (โหมดโค้ดยังดึงโจทย์โค้ดเหมือนเดิม) หรือให้เซิร์ฟเวอร์เลือกเอง
      const useFmt = forceFmt !== undefined ? forceFmt : (pullStyle || (mode === "code" ? "code" : ""));
      // focusTopics = หัวข้อที่เลือกไว้ในหน้าเลือกก่อนดึง (ไม่เลือก = ทั้งวิชา)
      const r = await tutorProblem(subjectId, useFmt, seen, src, focusTopics);
      setProblem(r);
      if (r?.source) setSeen((s) => [...s, r.source.materialId + "|" + String(r.problem).slice(0, 40)].slice(-20));
      // สุ่มโจทย์ใหม่ = ต้องเห็นผลลัพธ์ทันที ไม่ใช่ถูกเลื่อนไปเอาท้ายจอ
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
    } catch (e: any) {
      setProblem(null);
      setProbErr(String(e?.message || e).replace(/^Error:\s*/, ""));
    } finally { setProbBusy(false); }
  }

  /** โจทย์ซ้อน: สร้างโจทย์ใหม่จากไฟล์เดียวกัน ให้ลองทำเอง — ไม่มีโค้ดตัวอย่าง */
  async function loadVariant() {
    if (needSubject()) return;
    if (!problem?.source?.materialId) { Alert2("ยังไม่มีโจทย์", "กดสุ่มโจทย์ก่อน แล้วค่อยขอโจทย์ซ้อน"); return; }
    setProbBusy(true); setProbErr(""); setMark(null); setMyAnswer(""); setPicked(-1); setDoneItems([]); setMissing([]); resetHints(); resetAnalysis();
    try {
      const r = await tutorProblemVariant(subjectId, fmt || "", problem.source.materialId);
      setProblem(r);
      // โจทย์ซ้อนคนละข้อ = ให้ถือว่ายังไม่เคยเห็น เพื่อไม่ให้ถูกกรองออกตอนสุ่มรอบหน้า
      if (r?.source) setSeen((s) => [...s, r.source.materialId + "|" + String(r.problem).slice(0, 40)].slice(-20));
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
    } catch (e: any) {
      Alert2("สุ่มโจทย์ซ้อนไม่สำเร็จ", String(e?.message || e).replace(/^Error:\s*/, ""));
    } finally { setProbBusy(false); }
  }
  async function checkMyAnswer() {
    if (!problem) return;
    if (fmt === "options") {
      if (picked < 0) { Alert2("ยังไม่ได้เลือก", "แตะตัวเลือกที่คิดว่าถูกก่อน"); return; }
      // ตรวจกับ "รายการเดียวกับที่แสดง" (uniqueOptions) — กัน index เพี้ยนเมื่อมีตัวเลือกซ้ำถูกตัดออก
      const list = uniqueOptions<any>(problem.options || []);
      const chosen = list[picked];
      const right = list.find((o: any) => (typeof o === "object" ? o?.correct : false));
      setMark({ correct: chosen?.correct === true, feedback: chosen?.correct ? "ถูกต้อง" : `ยังไม่ใช่ — เฉลยคือ "${right?.text || "-"}"`, points: [], next: "" });
      if (chosen?.explain) speak(spokenText(chosen.explain));
      return;
    }
    if (!myAnswer.trim()) { Alert2("ยังไม่ได้เขียนคำตอบ", "พิมพ์คำตอบก่อนแล้วกดตรวจ"); return; }
    setMarkBusy(true);
    try {
      const r = await tutorCheckAnswer(subjectId, problem.problem, myAnswer, problem.deliverables || [], doneItems);
      setMark(r.feedback);
      if (r.missing?.length) setMissing(r.missing);
      if (typeof r.feedback === "object" && r.feedback.fix) speak(spokenText(r.feedback.fix));
    } catch (e: any) {
      Alert2("ตรวจไม่สำเร็จ", String(e?.message || e));
    } finally { setMarkBusy(false); }
  }

  const [opening, setOpening] = useState<any>(null);
  const [openBusy, setOpenBusy] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);

  /* --- ขั้นตอนเริ่มต้น: อยากให้ช่วยเรื่องไหน → อ่อนอะไร → เริ่ม/ข้าม --- */
  const [stage, setStage] = useState<"want" | "weak" | "choose" | "ready">("want");
  const [weakTopic, setWeakTopic] = useState("");
  const [choices, setChoices] = useState<Record<string, "start" | "skip">>({});
  const [myPlan, setMyPlan] = useState<any>(null);
  const [myPlanBusy, setMyPlanBusy] = useState(false);
  const [onboardOff, setOnboardOff] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  // ใช้เลื่อนหน้าจอไปยังช่องตอบหลังร่างโค้ดเสร็จ
  const answerRef = useRef<View>(null);
  const scrollYRef = useRef(0);
  const topics: any[] = opening?.topics || [];
  // โหมดของวิชาอาจมากกว่า 3 ตัว (คำศัพท์/ไวยากรณ์/กรณีศึกษา/ทำตามขั้นตอน) ต้องมีค่าสำรองเสมอ
  const openChoice: any = (opening?.choices || []).find((c: any) => c.key === mode);
  const modeMeta = MODES.find((m) => m.k === mode)
    || (openChoice ? { k: mode, label: openChoice.label, hint: openChoice.sub || "", icon: openChoice.icon, color: "#a78bfa" } : null)
    || MODES[0];
  const speedMeta = SPEEDS.find((s) => s.k === speed)!;
  const levelMeta = LEVELS.find((l) => l.k === level)!;
  const tabMeta = TABS.find((t) => t.k === tab)!;

  useEffect(() => { getSubjects().then(setSubjects).catch(() => undefined); }, []);
  useEffect(() => { if (!subjectId && subjects[0]?.id) setSubjectId(subjects[0].id); }, [subjects, subjectId]);
  // เปลี่ยนวิชา = เริ่มโหมดใหม่เสมอ — กัน "โหมดโค้ด" ค้างจากวิชาก่อนหน้า
  // ไปบังคับโจทย์ของวิชาที่เนื้อหาไม่มีเขียนโค้ด (เช่น 1204102)
  useEffect(() => { setMode("explain"); }, [subjectId]);

  useEffect(() => {
    if (!subjectId) return;
    let alive = true;
    setOpening(null); setOpenBusy(true);
    tutorOpen(subjectId, level)
      .then((r) => { if (alive) setOpening(r); })
      .catch(() => undefined)
      .finally(() => { if (alive) setOpenBusy(false); });
    return () => { alive = false; };
  }, [subjectId, level]);
  // โหมดที่วิชานี้ใช้ได้จริง — ดึงจาก /open ที่หน้านี้เรียกอยู่แล้ว
  // (ไม่เรียกซ้ำ เพราะทุกครั้งที่เรียก /open คือสั่ง AI ใหม่ = เสียเวลา+เงิน)
  const subjectModes = useMemo(() => {
    const raw: any[] = Array.isArray(opening?.choices) ? opening!.choices : [];
    return raw.map((c: any) => {
      const local: any = MODES.find((x) => x.k === c.key);
      return {
        k: c.key,
        label: c.label,
        icon: c.icon,
        hint: c.sub || local?.hint || "",
        color: local?.color || "#a78bfa",
      };
    });
  }, [opening]);
  // ถ้าโหมดที่เลือกไว้ไม่อยู่ในรายการของวิชานี้ ให้เด้งกลับเป็นอันแรก
  useEffect(() => {
    if (!subjectModes.length) return;
    if (!subjectModes.some((m) => m.k === mode)) setMode(subjectModes[0].k as Mode);
  }, [subjectModes, mode]);

  const subject = useMemo(() => subjects.find((s) => s.id === subjectId), [subjects, subjectId]);
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? subjects.filter((s) => String(s.name).toLowerCase().includes(k)) : subjects;
  }, [subjects, q]);

  const needSubject = () => {
    if (!subjectId) { Alert2("ยังไม่ได้เลือกวิชา", "แตะที่ชื่อวิชาด้านบนก่อน"); return true; }
    return false;
  };

  async function play(text: string, tag: string) {
    setSpeaking(tag);
    try { await speak(text); } finally { setTimeout(() => setSpeaking((v) => (v === tag ? null : v)), 400); }
  }

  function resetOnboarding() {
    setStage("want"); setWeakTopic(""); setChoices({}); setMyPlan(null);
    setQuiz(null); setResult(null); setMessages([]); setOnboardOff(false);
    setProblem(null); setProbErr(""); setMark(null); setMyAnswer(""); setPicked(-1); setSeen([]);
  }

  /* ---------------------------------------------------------------- */

  async function ask(text: string, overrideMode?: Mode) {
    if (needSubject() || !text.trim()) return;
    const q0 = text.trim();
    const useMode = overrideMode || mode;
    setMessages((m) => [...m, { role: "me", text: q0 }]);
    setQuestion("");
    setOnboardOff(true);
    setBusy(true);
    const aiIdx = messages.length + 1;
    setMessages((m) => [...m, { role: "ai", text: "", sources: [], streaming: true }]);
    let acc = "";
    try {
      await tutorAskStream(subjectId, q0, level, useMode, speed, {
        onSources: (s) => setMessages((m) => m.map((x, i) => (i === aiIdx ? { ...x, sources: s } : x))),
        onDelta: (t) => {
          acc += t;
          setMessages((m) => m.map((x, i) => (i === aiIdx ? { ...x, text: x.text + t } : x)));
        },
        onDone: (d) => {
          setMessages((m) => m.map((x, i) => (i === aiIdx ? {
            ...x, streaming: false, usedModel: d?.usedModel !== false, grounded: d?.grounded !== false,
          } : x)));
          if (autoSpeak && acc.trim().length > 10) speak(spokenText(acc));
        },
        onError: (e) => setMessages((m) => m.map((x, i) => (i === aiIdx ? { ...x, streaming: false, text: x.text || ("ผิดพลาด: " + e) } : x))),
      });
    } catch (e) {
      setMessages((m) => m.map((x, i) => (i === aiIdx ? { ...x, streaming: false, text: "ผิดพลาด: " + String(e) } : x)));
    } finally { setBusy(false); }
  }

  async function loadPlan() {
    if (needSubject()) return;
    setPlanBusy(true);
    try { setPlan(await tutorPlan(subjectId)); }
    catch (e) { Alert2("สร้างแผนไม่สำเร็จ", String(e)); }
    finally { setPlanBusy(false); }
  }

  async function buildMyPlan() {
    if (needSubject() || !topics.length) return;
    setMyPlanBusy(true);
    try {
      const list = topics.map((t: any) => ({ title: t.title, choice: choices[t.title] || "start" }));
      const r = await tutorStudyPlan(subjectId, list, weakTopic);
      setMyPlan(r);
      setStage("ready");
      setTab("plan");
      if (r.recommendation) speak(spokenText(r.recommendation));
    } catch (e) {
      Alert2("สร้างแผนไม่สำเร็จ", String(e));
    } finally { setMyPlanBusy(false); }
  }

  async function startQuizFocused(list?: string[]) {
    if (needSubject()) return;
    const focus = list?.length ? list : focusTopics;
    setQuizBusy(true); setResult(null); setQuiz(null); setPicks([]);
    try {
      const r = await tutorDiagnose(subjectId, level, focus.length ? focus : undefined);
      setQuiz(r); setPicks(new Array(r.questions.length).fill(-1));
    } catch (e) { Alert2("สร้างข้อสอบไม่สำเร็จ", String(e)); }
    finally { setQuizBusy(false); }
  }

  async function submitQuiz() {
    if (!quiz) return;
    if (picks.some((p) => p < 0)) { Alert2("ยังตอบไม่ครบ", "เลือกคำตอบทุกข้อก่อน"); return; }
    setQuizBusy(true);
    try {
      const r = await tutorEvaluate(subjectId, quiz.questions, picks, quiz.quizId);
      setResult(r);
      if (r.advice) speak(spokenText(r.advice));
    } catch (e) { Alert2("ประเมินไม่สำเร็จ", String(e)); }
    finally { setQuizBusy(false); }
  }

  /* ---------------------------------------------------------------- */

  return <View style={styles.screen}>
    {/* ============ แถบบนสุด: วิชา + ระดับความยาก ============ */}
    <View style={styles.topBar}>
      <View style={styles.topRow}>
        <Text style={styles.brand}>STUDYPATH AI</Text>
        <Text style={styles.topTitle}>อาจารย์ AI</Text>
        <View style={styles.nowTab}>
          <Text style={styles.nowTabText}>{tabMeta.label}</Text>
        </View>
      </View>

      {/* แถบวิชา — ผูกกดเปิดตัวเลือกวิชาไว้เฉพาะส่วนซ้าย
          (ถ้าครอบทั้งแถบ ปุ่ม "ระดับ" ซ้อนข้างในจะถูกกดพร้อมกัน เพราะ RNW
          ใช้ responder ไม่ใช่ DOM propagation — stopPropagation ไม่มีผล) */}
      <View style={styles.subjectCard}>
        <Pressable style={styles.subjectHit} onPress={() => setPickerOpen(true)}>
          <View style={styles.subjectIcon}><Ionicons name="book-outline" size={16} color="#a78bfa" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.subjectName} numberOfLines={1}>
              {subject?.name || (subjects.length ? "เลือกวิชา" : "ยังไม่ได้เข้าสู่ระบบ")}
            </Text>
            <Pill text={`${subject?._count?.materials ?? 0} ไฟล์`} color="#38bdf8" />
          </View>
        </Pressable>
        <Pressable style={styles.levelHit} onPress={() => setOptOpen(true)}>
          <Pill text={`ระดับ: ${levelMeta.label}`} color={levelMeta.color} />
        </Pressable>
        <Pressable style={styles.changeBtn} onPress={() => setPickerOpen(true)}>
          <Text style={styles.changeText}>เปลี่ยน</Text>
          <Ionicons name="chevron-down" size={13} color="#a78bfa" />
        </Pressable>
      </View>

      {/* ระดับความยาก + แท็บทั้งหมด ย้ายไปอยู่ในเมนู ☰ ด้านล่างแล้ว */}
    </View>

    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      onScroll={(e) => { scrollYRef.current = e.nativeEvent?.contentOffset?.y ?? 0; }}
    >
      {tab === "chat" ? <>
        {/* ===== ขั้นตอนเริ่มต้น ===== */}
        {opening && !messages.length && !opening.empty && topics.length && !onboardOff ? <Card style={styles.panel}>

          {stage === "want" ? <>
            <Text style={font.h2}>👋 {opening.greeting}</Text>
            <Text style={font.caption}>เลือกว่าอยากให้ช่วยเรื่องไหนก่อน แล้วผมจะเริ่มจากเนื้อหาที่ดีที่สุดให้</Text>
            <View style={styles.wantGrid}>
              {(opening.choices || []).map((c: any, i: number) => <Pressable key={i} style={styles.wantCard}
                onPress={() => ask(c.prompt, c.key as Mode)}>
                <View style={[styles.wantIcon, { backgroundColor: (modeMeta.color || "#a78bfa") + "22" }]}>
                  <Ionicons name={c.icon as any} size={19} color={modeMeta.color || "#a78bfa"} />
                </View>
                <Text style={styles.wantLabel}>{c.label}</Text>
                <Text style={styles.wantSub} numberOfLines={2}>{c.sub}</Text>
              </Pressable>)}
            </View>
            <Pressable style={styles.ghostBtn} onPress={() => setStage("weak")}>
              <Text style={styles.ghostText}>ไม่แน่ใจ → ให้ช่วยประเมินจุดอ่อนให้</Text>
            </Pressable>
          </> : null}

          {stage === "weak" ? <>
            <Text style={font.h2}>คุณอ่อนด้านไหนมากที่สุด?</Text>
            <Text style={font.caption}>ผมอ่านหัวข้อในวิชานี้แล้ว {opening.totalMaterials} รายการ เลือกหัวข้อที่รู้สึกว่าไม่เข้าใจที่สุด</Text>
            <View style={{ gap: 8, marginTop: 12 }}>
              {topics.map((t: any, i: number) => <Pressable key={i} style={styles.optRow}
                onPress={() => { setWeakTopic(t.title); setStage("choose"); }}>
                <View style={styles.radio}><Ionicons name="trending-down-outline" size={16} color="#f59e0b" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={font.title}>{t.title}</Text>
                  <Text style={font.caption} numberOfLines={2}>{t.summary}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 5 }}>
                    <Pill text={t.level || "กลาง"} color={t.level === "พื้นฐาน" ? "#34d399" : t.level === "สูง" ? "#f43f5e" : "#38bdf8"} />
                    {t.kind ? <Pill text={t.kind} color="#a78bfa" /> : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
              </Pressable>)}
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Pressable style={styles.ghostBtn} onPress={() => { setWeakTopic(""); setStage("choose"); }}>
                <Text style={styles.ghostText}>ไม่แน่ใจ / ให้ช่วยประเมิน</Text>
              </Pressable>
              <Pressable style={styles.ghostBtn} onPress={() => setStage("want")}>
                <Text style={styles.ghostText}>ย้อนกลับ</Text>
              </Pressable>
            </View>
          </> : null}

          {stage === "choose" ? <>
            <Text style={font.h2}>เริ่มต้นเลย หรือข้าม?</Text>
            <Text style={font.caption}>
              จุดอ่อนของคุณ: <Text style={{ color: "#f59e0b", fontWeight: "900" }}>{weakTopic || "ให้ช่วยประเมิน"}</Text>
            </Text>
            <View style={{ gap: 10, marginTop: 12 }}>
              {topics.map((t: any, i: number) => {
                const c = choices[t.title];
                const isWeak = t.title === weakTopic;
                return <View key={i} style={[styles.optRow, isWeak && { borderColor: "#f59e0b", backgroundColor: "#f59e0b18" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={font.title}>{t.title}</Text>
                    {isWeak ? <Text style={[font.caption, { color: "#f59e0b" }]}>← หัวข้อที่คุณบอกว่าอ่อนที่สุด (จะเริ่มตั้งแต่พื้นฐาน)</Text> : null}
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <Pressable style={[styles.miniBtn, c === "start" && styles.miniStart]} onPress={() => setChoices({ ...choices, [t.title]: "start" })}>
                        <Ionicons name="play" size={12} color={c === "start" ? "#ffffff" : "#34d399"} />
                        <Text style={[styles.miniBtnText, c === "start" && { color: "#ffffff" }]}>เริ่มต้นเลย</Text>
                      </Pressable>
                      <Pressable style={[styles.miniBtn, c === "skip" && styles.miniSkip]} onPress={() => setChoices({ ...choices, [t.title]: "skip" })}>
                        <Ionicons name="play-skip-forward" size={12} color={c === "skip" ? "#ffffff" : colors.textMuted} />
                        <Text style={[styles.miniBtnText, c === "skip" && { color: "#ffffff" }]}>ข้ามไปก่อน</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>;
              })}
            </View>
            <Button onPress={buildMyPlan} loading={myPlanBusy} icon="map-outline">สร้างแผนเรียนของฉัน</Button>
          </> : null}

          {stage === "ready" ? <>
            <Text style={font.h2}>พร้อมเริ่มแล้ว</Text>
            <Text style={font.caption}>เริ่ม {Object.values(choices).filter((c) => c === "start").length} หัวข้อ · ข้าม {Object.values(choices).filter((c) => c === "skip").length} หัวข้อ</Text>
            {myPlan?.recommendation ? <View style={styles.recommendBox}><RichText text={myPlan.recommendation} /></View> : null}
            <View style={{ gap: 8, marginTop: 12 }}>
              {(myPlan?.steps || []).map((s: any, i: number) => <View key={i} style={styles.stepRow}>
                <View style={styles.topicNum}><Text style={styles.topicNumText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={font.title}>{s.title}</Text>
                  {s.detail ? <Text style={font.caption}>{s.detail}</Text> : null}
                  {s.minutes ? <Text style={[font.caption, { color: "#38bdf8" }]}>≈ {s.minutes} นาที</Text> : null}
                </View>
              </View>)}
            </View>
            <View style={{ gap: 8, marginTop: 14 }}>
              <Button onPress={() => startQuizFocused(topics.filter((t: any) => (choices[t.title] || "start") === "start").map((t: any) => t.title))} icon="checkmark-circle-outline">เริ่มแบบทดสอบ</Button>
              <Button onPress={() => { setOnboardOff(true); setTab("chat"); }} variant="secondary" icon="chatbubbles-outline">ถามอาจารย์ AI ต่อ</Button>
              <Pressable style={styles.ghostBtn} onPress={resetOnboarding}><Text style={styles.ghostText}>เริ่มใหม่</Text></Pressable>
            </View>
          </> : null}
        </Card> : null}

        {opening?.empty ? <Card style={styles.panel}>
          <Text style={font.h2}>ยังไม่มีเนื้อหาในวิชานี้</Text>
          <Text style={font.caption}>{opening.greeting}</Text>
          <Button onPress={() => Linking.openURL("/classroom")} icon="cloud-download-outline">ไปหน้า Classroom เพื่อซิงก์</Button>
        </Card> : null}

        {openBusy ? <View style={styles.thinking}><ActivityIndicator color={colors.accent} /><Text style={font.caption}>อาจารย์ AI กำลังอ่านเนื้อหาในวิชา...</Text></View> : null}

        {/* ไม่มีวิชาเลย — บอกให้ชัดว่าต้องทำอะไรต่อ ไม่ใช่ค้างเงียบๆ */}
        {!openBusy && !subjects.length ? <Card style={styles.panel}>
          <Text style={font.h2}>ยังโหลดรายชื่อวิชาไม่ได้</Text>
          <Text style={font.caption}>
            สาเหตุที่พบบ่อย: เซสชันหมดอายุ หรือยังไม่ได้เชื่อม Google Classroom
          </Text>
          <View style={{ gap: 8, marginTop: 12 }}>
            <Button onPress={() => Linking.openURL("/classroom")} icon="cloud-download-outline">ไปหน้า Classroom</Button>
            <Pressable style={styles.ghostBtn} onPress={() => getSubjects().then(setSubjects).catch(() => Alert.alert("ยังลองไม่ได้", "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองเชื่อม Google Classroom ใหม่"))}>
              <Text style={styles.ghostText}>ลองโหลดใหม่</Text>
            </Pressable>
          </View>
        </Card> : null}

        {/* มีวิชาแต่ยังไม่ได้เลือก */}
        {!openBusy && subjects.length && !subjectId ? <Card style={styles.panel}>
          <Text style={font.h2}>เลือกวิชาที่จะเรียน</Text>
          <Text style={font.caption}>มี {subjects.length} วิชาในบัญชีของคุณ — แตะชื่อวิชาด้านบนเพื่อเลือก</Text>
        </Card> : null}

        {!opening && !messages.length ? <GlowCard style={styles.banner}>
          <Text style={styles.bannerTitle}>พร้อมสอนคุณ · {modeMeta.label} · {speedMeta.label}</Text>
          <Text style={styles.bannerText}>ทุกคำตอบยึดไฟล์ใน Google Classroom เป็นหลัก ถ้าไม่มีข้อมูลรองรับจะบอกตรงๆ ว่าเป็นความรู้ทั่วไป</Text>
        </GlowCard> : null}

        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === "me" ? styles.bubbleMe : styles.bubbleAi]}>
            {m.role === "me" ? <Text style={styles.textMe}>{m.text}</Text> : <RichText text={m.text} streaming={m.streaming} />}
            {m.role === "ai" && m.sources?.length ? <View style={styles.sources}>
              <Text style={styles.srcTitle}>📎 อ้างอิงจาก Google Classroom</Text>
              {m.sources.map((s: any, j: number) => {
                // ไฟล์ที่ sync มาแบบข้อความล้วนไม่มีลิงก์เลย ถ้าวาดเป็น "ลิ้ง" แล้วกดจะไม่เกิดอะไร
                const openable = !!s.url;
                const row = (
                  <>
                    <Ionicons
                      name={openable ? "link-outline" : s.hasFile ? "document-text-outline" : "reader-outline"}
                      size={14}
                      color={openable ? "#a78bfa" : s.hasFile ? "#38bdf8" : "#94a3b8"}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.srcName} numberOfLines={1}>{s.title}</Text>
                      <Text style={styles.srcMeta} numberOfLines={1}>{s.sourceLabel || ""}{s.updatedAt ? " · " + new Date(s.updatedAt).toLocaleDateString("th-TH") : ""}</Text>
                    </View>
                    {openable ? <Ionicons name="open-outline" size={14} color={colors.textMuted} /> : null}
                  </>
                );
                return openable ? (
                  <Pressable key={j} style={styles.src}
                    onPress={() => Linking.openURL(s.url).catch(() => Alert.alert("เปิดไม่ได้", "ลิงก์นี้อาจถูกลบไปแล้ว"))}>
                    {row}
                  </Pressable>
                ) : (
                  <View key={j} style={[styles.src, styles.srcPlain]}>{row}</View>
                );
              })}
            </View> : null}
            {m.role === "ai" ? <View style={styles.voiceRow}>
              <Pressable style={[styles.voice, speaking === String(i) && { opacity: .6 }]} onPress={() => play(m.text, String(i))}>
                <Ionicons name="volume-high-outline" size={14} color="#a78bfa" />
                <Text style={styles.voiceText}>{speaking === String(i) ? "กำลังโหลดเสียง..." : "อ่านออกเสียง"}</Text>
              </Pressable>
              <Pressable style={styles.voice} onPress={stopSpeak}><Ionicons name="stop-circle-outline" size={14} color="#f59e0b" /><Text style={styles.voiceText}>หยุด</Text></Pressable>
              {m.grounded === false
                ? <Pill text="ความรู้ทั่วไป" color="#f59e0b" />
                : m.usedModel ? <Pill text="จากไฟล์จริง" color="#34d399" /> : <Pill text="ดึงจากไฟล์" color="#38bdf8" />}
            </View> : null}
          </View>
        ))}

        {busy ? <View style={styles.thinking}>
          <ActivityIndicator color={colors.accent} />
          <Text style={font.caption}>กำลังค้นหาเนื้อหาในวิชาและเรียบเรียงคำตอบ ({modeMeta.label} · {speedMeta.label})...</Text>
        </View> : null}

        <View style={{ height: 8 }} />
      </> : null}

      {tab === "plan" ? <>
        {myPlan ? <Card style={styles.panel}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Ionicons name="person-circle-outline" size={18} color="#f59e0b" />
            <Text style={font.h2}>แผนของคุณเอง</Text>
          </View>
          <Text style={font.caption}>จุดอ่อน: {weakTopic || "ให้ช่วยประเมิน"}</Text>
          {myPlan.recommendation ? <View style={styles.recommendBox}><RichText text={myPlan.recommendation} /></View> : null}
          <View style={{ gap: 8, marginTop: 12 }}>
            {(myPlan.steps || []).map((s: any, i: number) => <Pressable key={i} style={styles.stepRow}
              onPress={() => { setTab("chat"); setTimeout(() => ask(`อธิบายหัวข้อ "${s.title}" ให้ละเอียด พร้อม flowchart และโค้ดตัวอย่าง`), 80); }}>
              <View style={styles.topicNum}><Text style={styles.topicNumText}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={font.title}>{s.title}</Text>
                {s.detail ? <Text style={font.caption}>{s.detail}</Text> : null}
                {s.minutes ? <Text style={[font.caption, { color: "#38bdf8" }]}>≈ {s.minutes} นาที</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
            </Pressable>)}
          </View>
          {myPlan.skipped?.length ? <Text style={[font.caption, { marginTop: 10 }]}>ข้ามไป: {myPlan.skipped.join(" · ")}</Text> : null}
          <View style={{ gap: 8, marginTop: 14 }}>
            <Button onPress={() => { setTab("diag"); startQuizFocused((myPlan.steps || []).map((s: any) => s.title)); }} icon="checkmark-circle-outline">ทำข้อสอบตามแผนนี้</Button>
            <Pressable style={styles.ghostBtn} onPress={resetOnboarding}><Text style={styles.ghostText}>ปรับแผนใหม่</Text></Pressable>
          </View>
        </Card> : null}

        <Card style={styles.panel}>
          <Text style={font.h2}>แผนการเรียนทั้งวิชา</Text>
          <Text style={font.caption}>ระบบอ่านหัวข้อจากไฟล์ทั้งหมดในวิชา แล้วเรียงลำดับว่าควรเริ่มที่ไหน</Text>
          <Button onPress={loadPlan} loading={planBusy} icon="map-outline">สร้างแผนการเรียน</Button>
        </Card>

        {plan ? <Card style={styles.panel}>
          <Text style={styles.recTitle}>คำแนะนำ</Text>
          <RichText text={plan.recommendation || ""} />
          <Text style={font.caption}>อ้างอิงจาก {plan.materialCount} รายการ {plan.generatedByAi ? "(วิเคราะห์โดย AI)" : "(ยังไม่ได้ต่อ AI)"}</Text>
          <View style={{ gap: 8, marginTop: 12 }}>
            {(plan.topics || []).map((t: any, i: number) => <Pressable key={i} style={styles.stepRow}
              onPress={() => { setTab("chat"); setTimeout(() => ask(`อธิบายหัวข้อ "${t.title}" ให้ละเอียด พร้อม flowchart`), 80); }}>
              <View style={styles.topicNum}><Text style={styles.topicNumText}>{t.order ?? i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={font.title}>{t.title}</Text>
                <Text style={font.caption} numberOfLines={2}>{t.summary}</Text>
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                  <Pill text={t.level || "กลาง"} color={t.level === "พื้นฐาน" ? "#34d399" : t.level === "สูง" ? "#f43f5e" : "#38bdf8"} />
                  {t.reason ? <Text style={font.caption} numberOfLines={1}>· {t.reason}</Text> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
            </Pressable>)}
          </View>
        </Card> : null}
        <View style={{ height: 8 }} />
      </> : null}

      {tab === "diag" ? <>
        {/* ===== ดึงโจทย์จริงจากในวิชา ===== */}
        <Card style={styles.panel}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="document-attach-outline" size={19} color="#4ade80" />
            <Text style={font.h2}>โจทย์จากในวิชา</Text>
          </View>
          <Text style={font.caption}>{pullStyle === "code" ? "หมวดโค้ด — สุ่มโจทย์แนวเขียน/อ่านโค้ด มีช่องโค้ดให้ตอบ พร้อมใบ้ทีละบรรทัด" : pullStyle === "options" ? "หมวดตัวเลือก — โจทย์พร้อมตัวเลือก 4 ข้อ (ก ข ค ง)" : "ดึงโจทย์จริงจากไฟล์ที่ซิงก์มา ระบบจะเลือกรูปแบบคำตอบให้เองตามโจทย์"}</Text>

          <Text style={styles.segLabel}>โจทย์มาจาก</Text>
          <View style={styles.srcRow}>
            {([
              ["class", "ไฟล์ในวิชา", "document-text-outline"],
              ["submission", "งานที่ส่งไป", "cloud-upload-outline"],
            ] as const).map(([k, t, ic]) => {
              const on = src === k;
              return <Pressable key={k} style={[styles.srcChip, on && styles.srcChipOn]} onPress={() => { setSrc(k); setProblem(null); }}>
                <Ionicons name={ic as any} size={13} color={on ? "#38bdf8" : colors.textMuted} />
                <Text style={[styles.srcChipText, on && { color: "#38bdf8" }]}>{t}</Text>
              </Pressable>;
            })}
          </View>

          <Button onPress={() => setPickStage((p) => !p)} loading={probBusy} icon="shuffle-outline">
            {problem ? "สุ่มโจทย์ใหม่" : "ดึงโจทย์จากวิชานี้"}
          </Button>
        </Card>

        {/* ===== หน้าเลือกก่อนดึง — กด "ดึงโจทย์" แล้วขึ้นตรงนี้:
             เลือกว่าจะเอาโจทย์ "แนวไหนบ้าง" + "หัวข้อไหนบ้าง" ค่อยกดดึงจริง ===== */}
        {pickStage ? <Card style={styles.panel}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="options-outline" size={19} color="#a78bfa" />
            <Text style={font.h2}>เลือกโจทย์ที่ต้องการ</Text>
          </View>
          <Text style={font.caption}>เลือกแนวโจทย์และหัวข้อที่อยากได้ แล้วกดดึง — ไม่เลือก = สุ่มจากทั้งวิชา</Text>

          {/* แนวโจทย์ — แยกเป็น "หมวดย่อย" คนละอัน ห้ามปนกัน:
               ทั่วไป / โค้ด / หลายตัวเลือก (แต่ละอันมีผลเฉพาะรอบดึงนี้ ไม่ไปเปลี่ยนโหมดหลัก) */}
          <View style={{ marginTop: 14 }}>
            <Text style={styles.segLabel}>แนวโจทย์</Text>
            <Text style={font.caption}>เลือกได้อย่างเดียว — มีผลเฉพาะการดึงรอบนี้ ไม่เปลี่ยนโหมดหลัก</Text>

            {/* หมวดทั่วไป — ระบบดูโจทย์แล้วเลือกรูปแบบคำตอบให้เอง */}
            <Text style={styles.sylGroup}>ทั่วไป</Text>
            <View style={styles.srcRow}>
              <Pressable style={[styles.srcChip, pullStyle === "" && styles.srcChipOn]} onPress={() => setPullStyle("")}>
                <Ionicons name="grid-outline" size={13} color={pullStyle === "" ? "#a78bfa" : colors.textMuted} />
                <Text style={[styles.srcChipText, pullStyle === "" && { color: "#a78bfa" }]}>ระบบเลือกรูปแบบให้เอง</Text>
              </Pressable>
            </View>

            {/* หมวดโค้ด — ยืนตั้งตัวหาก เฉพาะวิชาที่ไฟล์มีเนื้อหาเขียนโค้ดจริงเท่านั้น */}
            {(subjectModes.length ? subjectModes : FALLBACK_MODES).some((m) => m.k === "code") ? <>
              <Text style={styles.sylGroup}>โค้ด</Text>
              <View style={styles.srcRow}>
                <Pressable style={[styles.srcChip, pullStyle === "code" && styles.srcChipOn]} onPress={() => setPullStyle(pullStyle === "code" ? "" : "code")}>
                  <Ionicons name="code-slash-outline" size={13} color={pullStyle === "code" ? "#34d399" : colors.textMuted} />
                  <Text style={[styles.srcChipText, pullStyle === "code" && { color: "#34d399" }]}>เขียน / อ่านโค้ด</Text>
                </Pressable>
              </View>
            </> : null}

            {/* หมวดหลายตัวเลือก — แยกต่างหากจากโค้ดและทั่วไป ห้ามอยู่แถวเดียวกัน */}
            <Text style={styles.sylGroup}>ตัวเลือก</Text>
            <View style={styles.srcRow}>
              <Pressable style={[styles.srcChip, pullStyle === "options" && styles.srcChipOn]} onPress={() => setPullStyle(pullStyle === "options" ? "" : "options")}>
                <Ionicons name="list-outline" size={13} color={pullStyle === "options" ? "#fbbf24" : colors.textMuted} />
                <Text style={[styles.srcChipText, pullStyle === "options" && { color: "#fbbf24" }]}>โจทย์หลายตัวเลือก (ก ข ค ง)</Text>
              </Pressable>
            </View>
          </View>

          {/* หัวข้อที่วิชานี้มีจริง — อ่านจากไฟล์ที่ซิงก์มา (ใช้ชิปเดิมที่ย้ายมาจากบัตรวินิจฉัย) */}
          {sylBusy ? <Text style={font.caption}>กำลังอ่านหัวข้อในเนื้อหาวิชา...</Text> : null}
          {(syllabus?.topics || []).length ? <>
            <Text style={styles.segLabel}>หัวข้อที่วิชานี้มีจริง</Text>
            <Text style={font.caption}>ไม่เลือกไว้ = สุ่มโจทย์ทั้งวิชา</Text>
            {["พื้นฐาน", "โครงสร้าง", "ทดสอบ", "ทั่วไป"].map((g) => {
              const group = (syllabus.topics || []).filter((t: any) => t.group === g);
              if (!group.length) return null;
              return <View key={g} style={{ marginTop: 10 }}>
                <Text style={styles.sylGroup}>{g}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 6 }}>
                  {group.map((t: any) => {
                    const on = focusTopics.includes(t.label);
                    return <Pressable key={t.k + t.label} style={[styles.chip, on && styles.chipOn]} onPress={() => {
                      setFocusTopics((f) => on ? f.filter((x) => x !== t.label) : [...f, t.label]);
                    }}>
                      <Text style={[styles.chipText, on && { color: "#ffffff" }]}>{t.label}</Text>
                    </Pressable>;
                  })}
                </View>
              </View>;
            })}
          </> : !sylBusy ? <Text style={font.caption}>ยังไม่มีหัวข้อให้เลือก — จะดึงจากทั้งวิชาแทน</Text> : null}

          <View style={{ gap: 8, marginTop: 14 }}>
            <Button onPress={async () => { await loadProblem(); setPickStage(false); }} loading={probBusy} icon="shuffle-outline">
              ดึงโจทย์ ({focusTopics.length ? focusTopics.length + " หัวข้อ" : "ทั้งวิชา"})
            </Button>
            <Button onPress={() => setPickStage(false)} variant="secondary" icon="close-outline">ไว้ทีหลัง</Button>
          </View>
        </Card> : null}

        {probErr ? <Card style={styles.panel}>
          <Text style={[font.h2, { color: "#f59e0b" }]}>ยังดึงโจทย์ไม่ได้</Text>
          <Text style={font.caption}>{probErr}</Text>
        </Card> : null}

        {problem ? <Card style={styles.panel}>
          <View style={styles.probHead}>
            <Pill text={fmtMeta.label} color="#4ade80" />
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Pressable style={styles.miniAction} onPress={() => setZoom(true)}>
                <Ionicons name="expand-outline" size={13} color="#38bdf8" /><Text style={styles.miniActionText}>ดูใหญ่</Text>
              </Pressable>
              <Pressable style={styles.miniAction} onPress={() => {
                const w: any = typeof window !== "undefined" ? window : null;
                if (w?.navigator?.clipboard) w.navigator.clipboard.writeText(problem.problem);
              }}>
                <Ionicons name="copy-outline" size={13} color="#a78bfa" /><Text style={styles.miniActionText}>คัดลอก</Text>
              </Pressable>
            </View>
            <Text style={styles.probCount}>{problem.totalProblems} โจทย์ในวิชานี้</Text>
          </View>


          {/* โจทย์ — แสดงผ่าน RichText เพื่อให้มีสี/กล่องเหมือนโค้ดและผังภาพ */}
          <View style={styles.probBox}><RichText text={problem.problem} tone="dark" /></View>

          {/* วิเคราะห์โจทย์ — แยกจากตัวโจทย์ (โจทย์ไม่มีส่วนวิเคราะห์ปน)
              ผู้เรียนกดดูเองตอนอยากเห็นแนวทาง Input/Output/Process/รหัสเทียม */}
          <Pressable
            style={[styles.ghostBtn, { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }, analysisBusy && { opacity: 0.55 }]}
            disabled={analysisBusy}
            onPress={toggleAnalysis}
          >
            <Ionicons name={analysisOpen ? "chevron-up-outline" : "bulb-outline"} size={14} color="#fbbf24" />
            <Text style={[styles.ghostText, { color: "#fbbf24" }]}>
              {analysisBusy ? "กำลังวิเคราะห์..."
                : analysis ? (analysisOpen ? "ซ่อนการวิเคราะห์" : "ดูการวิเคราะห์")
                : "วิเคราะห์โจทย์"}
            </Text>
          </Pressable>

          {analysis && analysisOpen ? (
            <View style={styles.analysisBox}>
              <View style={styles.hintHead}>
                <Ionicons name="bulb-outline" size={15} color="#fbbf24" />
                <Text style={styles.hintHeadText}>วิเคราะห์โจทย์</Text>
              </View>
              <Text style={styles.hintNote}>แนวทางทำโจทย์ — ลองคิดทำเองก่อนดูขั้นถัดไป</Text>

              {analysisSection("Input :", analysis.input)}
              {analysisSection("Output :", analysis.output)}
              {analysisSection("Process", analysis.process)}
              {analysisSection("ตัวแปรอื่น ๆ", analysis.variables)}
              {analysisSection("ค่าเริ่มต้น", analysis.initial)}

              {analysis.pseudocode ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.analysisH}>รหัสเทียม:</Text>
                  <View style={styles.analysisCode}>
                    {analysis.pseudocode.split("\n").map((l, i) => (
                      <Text key={i} style={styles.analysisCodeLine}>{l || " "}</Text>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* เจ้าหน้าที่เอาแถว "จาก: <ชื่อไฟล์>" ออกแล้ว — ส่วนใหญ่ไม่มีลิงก์จริงอยู่แล้ว
              กดไม่ได้ แลบังความสนใจจากตัวโจทย์ */}

          {/* ช่องตอบ */}
          <View ref={answerRef}>
          {fmt === "options" && problem.options?.length ? <View style={{ gap: 8, marginTop: 14 }}>
            {uniqueOptions(problem.options).map((o: any, i: number) => {
              const on = picked === i;
              return <Pressable key={i} style={[styles.opt, on && styles.optOn]} onPress={() => setPicked(i)}>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                <Text style={[styles.optText, on && { color: "#fff" }]}>{String.fromCharCode(65 + i)}. {o.text}</Text>
              </Pressable>;
            })}
          </View> : fmt === "options" ? <Text style={[font.caption, { marginTop: 10 }]}>โจทย์นี้ไม่มีตัวเลือก — ตอบเป็นข้อความแทน</Text>
            : fmt === "code" ? <View>
              {/* ผู้เรียนพิมพ์โค้ดเองที่นี่ — ใบ้ถูกสอดเข้ามาเป็นโครงในช่องเดียวกัน แก้/ต่อได้ทุกบรรทัด */}
              <CodeInput value={myAnswer} onChange={setMyAnswer} placeholder="พิมพ์โค้ดของคุณที่นี่..." />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Pressable style={styles.ghostBtn} onPress={() => setMyAnswer("")}><Text style={styles.ghostText}>ล้างโค้ด</Text></Pressable>
                {/* ใบ้ทีละบรรทัด — ยังไม่เคยขอ = ขอใบ้แรก / หลังนั้น = สอดใบ้ถัดไปเข้าช่องโค้ด */}
                <Pressable style={[styles.ghostBtn, hintBusy && { opacity: 0.5 }]} disabled={hintBusy}
                  onPress={() => { if (!hintLines.length) fetchHints(); else moreHint(); }}>
                  <Text style={styles.ghostText}>
                    {hintBusy ? "กำลังคิดใบ้..."
                      : !hintLines.length ? "ติด? ขอดูใบ้"
                      : hintShown >= hintLines.length ? "สอดใบ้ครบแล้ว"
                      : "ปลดล็อกใบ้ถัดไป"}
                  </Text>
                </Pressable>
                {hintLines.length && hintShown < hintLines.length ?
                  <Pressable style={styles.ghostBtn} onPress={revealAllHints}>
                    <Text style={styles.ghostText}>ยอมแพ้ ดูเฉลยหมด</Text>
                  </Pressable> : null}
              </View>

              {/* แถบสถานะใบ้ — บอกว่าสอดไปกี่บรรทัดแล้ว ใบ้อยู่ในช่องโค้ดด้านบน แก้ไขได้ */}
              {hintLines.length ? <View style={styles.hintBox}>
                <View style={styles.hintHead}>
                  <Ionicons name="bulb-outline" size={14} color="#fbbf24" />
                  <Text style={styles.hintHeadText}>ใบ้ใส่ในช่องโค้ดแล้ว {hintShown}/{hintLines.length} บรรทัด</Text>
                </View>
                <Text style={styles.hintNote}>ดูใบ้ในช่องโค้ดด้านบน แล้วแก้/เขียนต่อด้วยของคุณเองได้เลย ยังไม่ต้องเปิดหมดก็ได้</Text>
              </View> : null}
            </View>
            : <TextInput
              value={myAnswer} onChangeText={setMyAnswer} multiline
              placeholder="พิมพ์คำตอบของคุณ..."
              placeholderTextColor={colors.textMuted} style={styles.ansInput}
            />}
          </View>

          <View style={{ gap: 8, marginTop: 14 }}>
            <Button onPress={checkMyAnswer} loading={markBusy} icon="checkmark-done-outline">ตรวจคำตอบ</Button>
            <Button onPress={loadVariant} loading={probBusy} variant="secondary" icon="repeat-outline">ขอโจทย์ซ้อน</Button>
            <Button onPress={() => { loadProblem(); setTab("chat"); }} variant="secondary" icon="chatbubbles-outline">ถามอาจารย์ AI ช่วย</Button>
          </View>

          {mark ? <View style={styles.markBox}>
            {/* เฉลย: ถูก / ไม่ถูก ให้เห็นชัดที่สุด */}
            {typeof mark === "object" && mark.correct !== undefined ? (
              <View style={[styles.verdict, mark.correct ? styles.verdictOk : styles.verdictBad]}>
                <Ionicons name={mark.correct ? "checkmark-circle" : "close-circle"} size={26} color={mark.correct ? "#34d399" : "#f43f5e"} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.verdictTitle, { color: mark.correct ? "#34d399" : "#f43f5e" }]}>
                    {mark.correct ? "ถูกต้อง" : "ยังไม่ถูก"}
                  </Text>
                  {mark.score !== undefined ? <Text style={font.caption}>คะแนน {mark.score}/100</Text> : null}
                </View>
              </View>
            ) : <Text style={styles.markTitle}>ผลการตรวจ</Text>}
            <View style={{ marginTop: 10 }}>
              {typeof mark === "object" ? (
                <>
                  {mark.points?.length ? <RichText text={"* " + mark.points.join("\n* ")} /> : null}
                  {mark.fix ? <RichText text={"**ต้องแก้:** " + mark.fix} /> : null}
                </>
              ) : <RichText text={mark} />}
            </View>
          </View> : null}
        </Card> : null}

        <View style={styles.hr} />
        <Text style={styles.hrLabel}>หรือทำแบบวินิจฉัยอัตโนมัติ</Text>

        <Card style={styles.panel}>
          <Text style={font.h2}>วินิจฉัยอัตโนมัติ</Text>
          <Text style={font.caption}>ระบบสุ่มคำถาม 5 ข้อจากเนื้อหาในวิชา แล้วบอกว่าอะไรต้องเน้น อะไรข้ามได้</Text>

          {/* ชิปเลือกหัวข้อย้ายขึ้นไปหน้าเลือกก่อนดึงโจทย์แล้ว (เลือกที่เดียว ใช้ร่วมกัน) */}
          <Text style={[styles.segLabel, { marginTop: 14 }]}>หัวข้อที่จะสอบ</Text>
          <Text style={font.caption}>
            {focusTopics.length
              ? `เน้น ${focusTopics.length} หัวข้อ — เลือกไว้ตอนกด "ดึงโจทย์"`
              : `ไม่ได้เลือก = สอบทั้งวิชา — อยากเน้นหัวข้อให้เลือกตอนกด "ดึงโจทย์"`}
          </Text>

          <Button onPress={() => startQuizFocused()} loading={quizBusy} icon="checkmark-circle-outline">
            เริ่มข้อสอบ ({focusTopics.length ? focusTopics.length + " หัวข้อ" : "ทั้งวิชา"})
          </Button>
        </Card>

        {quiz && !result ? <View style={{ gap: 10 }}>
          <View style={styles.progressWrap}>
            <Text style={font.caption}>ตอบแล้ว {picks.filter((p) => p >= 0).length}/{quiz.questions.length} ข้อ</Text>
            <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${(picks.filter((p) => p >= 0).length / quiz.questions.length) * 100}%` }]} /></View>
            {quiz.focused?.length ? <Text style={font.caption}>เน้น: {quiz.focused.join(" · ")}</Text> : null}
          </View>
          {quiz.questions.map((qq: any, qi: number) => <Card key={qi} style={styles.qCard}>
            <Text style={styles.qNum}>ข้อที่ {qi + 1}{qq.topic ? ` · ${qq.topic}` : ""}</Text>
            <Text style={font.title}>{qq.question}</Text>
            {uniqueOptions<string>(qq.options).map((o: string, oi: number) => {
              const on = picks[qi] === oi;
              return <Pressable key={oi} onPress={() => { const n = [...picks]; n[qi] = oi; setPicks(n); }}
                style={[styles.opt, on && styles.optOn]}>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                <Text style={[styles.optText, on && { color: "#fff" }]}>{o}</Text>
              </Pressable>;
            })}
            <Pressable style={styles.voice} onPress={() => play(qq.question + " " + (qq.options || []).join(" "), "q" + qi)}>
              <Ionicons name="volume-high-outline" size={14} color="#a78bfa" /><Text style={styles.voiceText}>อ่านคำถาม</Text>
            </Pressable>
          </Card>)}
          <Button onPress={submitQuiz} loading={quizBusy} icon="checkmark">ส่งคำตอบ</Button>
        </View> : null}

        {result ? <Card style={styles.panel}>
          <View style={{ alignItems: "center", marginBottom: 12 }}>
            <Text style={[styles.score, { color: result.score >= 70 ? "#34d399" : result.score >= 40 ? "#f59e0b" : "#f43f5e" }]}>{result.score}</Text>
            <Text style={font.caption}>คะแนน ({result.correct}/{result.total})</Text>
          </View>
          <Text style={styles.recTitle}>คำแนะนำจากอาจารย์ AI</Text>
          <RichText text={result.advice || ""} />
          <Pressable style={[styles.voice, { alignSelf: "flex-start", marginTop: 8 }]} onPress={() => play(result.advice || "", "advice")}>
            <Ionicons name="volume-high-outline" size={14} color="#a78bfa" /><Text style={styles.voiceText}>อ่านคำแนะนำ</Text>
          </Pressable>
          <View style={{ gap: 8, marginTop: 14 }}>
            <Text style={font.title}>เน้นเรื่องนี้</Text>
            {result.weak?.length ? result.weak.map((w: any, i: number) => <View key={i} style={styles.badgeBad}><Text style={styles.badgeBadText}>{w.topic} — ถูก {Math.round(w.score * 100)}%</Text></View>) : <Text style={font.caption}>ไม่มีจุดอ่อนชัดเจน</Text>}
            <Text style={font.title}>ข้ามได้เลย</Text>
            {result.strong?.length ? result.strong.map((w: any, i: number) => <View key={i} style={styles.badgeGood}><Text style={styles.badgeGoodText}>{w.topic} — ถูก {Math.round(w.score * 100)}%</Text></View>) : <Text style={font.caption}>ยังข้ามหัวข้อไหนไม่ได้</Text>}
          </View>

          <Text style={[font.title, { marginTop: 16 }]}>ดูเฉลยทีละข้อ</Text>
          <View style={{ gap: 8, marginTop: 8 }}>
            {(result.results || []).map((r: any, i: number) => <View key={i} style={[styles.reviewRow, r.correct ? styles.reviewOk : styles.reviewBad]}>
              <Ionicons name={r.correct ? "checkmark-circle" : "close-circle"} size={17} color={r.correct ? "#34d399" : "#f43f5e"} />
              <View style={{ flex: 1 }}>
                <Text style={font.title}>{i + 1}. {r.question}</Text>
                <Text style={{ marginTop: 4, fontSize: 12, fontWeight: "700", color: r.correct ? "#34d399" : "#f43f5e" }}>
                  {r.correct ? "ตอบถูก ✓" : "ตอบผิด ✗"}
                </Text>
                <Text style={[font.caption, { color: "#34d399" }]}>เฉลย: {r.answer || "—"}</Text>
                <Text style={[font.caption, { color: r.correct ? "#34d399" : "#f43f5e" }]}>คำตอบของคุณ: {r.chosen || "ไม่ได้ตอบข้อนี้"}</Text>
                {r.explain ? <View style={{ marginTop: 4 }}>
                  <Text style={[font.caption, { fontWeight: "700" }]}>เหตุผล:</Text>
                  <RichText text={r.explain} />
                </View> : null}
              </View>
            </View>)}
          </View>

          <Button onPress={() => { setResult(null); setTab("plan"); loadPlan(); }} icon="map-outline" variant="secondary">ดูแผนการเรียน</Button>
          <Pressable style={styles.ghostBtn} onPress={() => { setResult(null); setQuiz(null); setPicks([]); }}>
            <Text style={styles.ghostText}>ทำข้อสอบอีกครั้ง</Text>
          </Pressable>
        </Card> : null}
        <View style={{ height: 8 }} />
      </> : null}
    </ScrollView>

    {/* ============ ช่องพิม + ตัวเลือกรวม ============ */}
    <View style={styles.composerWrap}>
      {optOpen ? <Pressable style={styles.popBackdrop} onPress={() => setOptOpen(false)} /> : null}

      {/* จุดยึดของเมนู — วัดจากแถบ Input โดยตรง จะได้ไม่ทับปุ่มล่าง */}
      <View style={styles.barAnchor}>
      {optOpen ? <>
        <View style={styles.pop}>
          <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* ไปยังหน้าต่างๆ */}
          <Text style={styles.popHead}>ไปที่</Text>
          <View style={styles.popCol}>
            {TABS.map((t) => {
              const on = tab === t.k;
              return <Pressable key={t.k} onPress={() => { setTab(t.k); setOptOpen(false); }}
                style={[styles.popItem, on && { borderColor: colors.accent, backgroundColor: colors.accent + "26" }]}>
                <Ionicons name={t.icon as any} size={15} color={on ? colors.accent : colors.textSecondary} />
                <Text style={[styles.popItemText, on && { color: "#fff" }]}>{t.label}</Text>
                {on ? <Ionicons name="checkmark" size={15} color={colors.accent} /> : <View style={{ flex: 1 }} />}
              </Pressable>;
            })}
          </View>

          <View style={styles.popDivider} />

          {/* โหมด */}
          <Text style={styles.popHead}>โหมด</Text>
          <View style={styles.popCol}>
            {(subjectModes.length ? subjectModes : FALLBACK_MODES).map((m) => {
              const on = mode === m.k;
              return <Pressable key={m.k} onPress={() => {
                const next = m.k as Mode;
                const toCode = next === "code" && mode !== "code";
                setMode(next); setOptOpen(false);
                // โหมดโค้ด = ไปหน้าโจทย์แล้วดึงโจทย์เขียน/อ่านโค้ดให้ทันที
                if (toCode) { setTab("diag"); if (!probBusy) loadProblem("code"); }
              }}
                style={[styles.popItem, on && { borderColor: m.color, backgroundColor: m.color + "26" }]}>
                <Ionicons name={m.icon as any} size={15} color={on ? m.color : colors.textSecondary} />
                <Text style={[styles.popItemText, on && { color: "#fff" }]}>{m.label}</Text>
                <Text style={styles.popItemHint} numberOfLines={1}>{m.hint}</Text>
                {on ? <Ionicons name="checkmark" size={15} color={m.color} /> : null}
              </Pressable>;
            })}
          </View>

          <View style={styles.popDivider} />

          {/* ความเร็ว */}
          <Text style={styles.popHead}>ความเร็ว</Text>
          <View style={styles.popCol}>
            {SPEEDS.map((s) => {
              const on = speed === s.k;
              return <Pressable key={s.k} onPress={() => { setSpeed(s.k); setOptOpen(false); }}
                style={[styles.popItem, on && { borderColor: "#38bdf8", backgroundColor: "#38bdf826" }]}>
                <Ionicons name={s.icon as any} size={15} color={on ? "#38bdf8" : colors.textSecondary} />
                <Text style={[styles.popItemText, on && { color: "#fff" }]}>{s.label}</Text>
                <Text style={styles.popItemHint} numberOfLines={1}>{s.hint}</Text>
                {on ? <Ionicons name="checkmark" size={15} color="#38bdf8" /> : null}
              </Pressable>;
            })}
          </View>

          <View style={styles.popDivider} />

          {/* ระดับความยาก */}
          <Text style={styles.popHead}>ระดับ</Text>
          <View style={styles.popCol}>
            {LEVELS.map((l) => {
              const on = level === l.k;
              return <Pressable key={l.k} onPress={() => { setLevel(l.k); setOptOpen(false); }}
                style={[styles.popItem, on && { borderColor: l.color, backgroundColor: l.color + "26" }]}>
                <Text style={[styles.popItemText, on && { color: "#fff" }]}>{l.label}</Text>
                <Text style={styles.popItemHint} numberOfLines={1}>{l.hint}</Text>
                {on ? <Ionicons name="checkmark" size={15} color={l.color} /> : null}
              </Pressable>;
            })}
          </View>

          <View style={styles.popDivider} />

          {/* ลัด */}
          <View style={styles.popCol}>
            {messages.length ? <Pressable style={styles.popItem} onPress={() => { setOptOpen(false); stopSpeak(); setMessages([]); }}>
              <Ionicons name="refresh-outline" size={15} color="#f59e0b" />
              <Text style={styles.popItemText}>ล้างบทสนทนา</Text>
              <Text style={styles.popItemHint} numberOfLines={1}>เริ่มใหม่</Text>
            </Pressable> : null}
          </View>
          </ScrollView>
        </View>
      </> : null}

      {/* แถบ Input — ปุ่มเมนูเล็กทางขวา ไม่กินพื้นที่พิม */}
      <View style={styles.bar}>
        {/* กล่องพิม — เต็มพื้นที่ */}
        <TextInput
          value={question} onChangeText={setQuestion} multiline
          placeholder={`ถามเกี่ยวกับ ${subject?.name || "วิชานี้"}...`}
          placeholderTextColor={colors.textMuted} style={styles.input}
        />

        {/* เสียง */}
        <Pressable
          style={[styles.iconBtn, autoSpeak && { borderColor: "#a78bfa", backgroundColor: "#a78bfa1f" }]}
          onPress={() => setAutoSpeak((v) => !v)}
        >
          <Ionicons name={autoSpeak ? "volume-high-outline" : "volume-mute-outline"} size={17}
            color={autoSpeak ? "#a78bfa" : colors.textMuted} />
        </Pressable>

        {/* หยุดเสียง — แสดงเฉพาะตอนพูดอยู่ */}
        {speaking ? <Pressable style={[styles.iconBtn, { borderColor: "#f59e0b" }]} onPress={stopSpeak}>
          <Ionicons name="stop-circle-outline" size={17} color="#f59e0b" />
        </Pressable> : null}

        {/* เมนูเล็ก — ปุ่มเดียวรวมทุกตัวเลือก */}
        <Pressable style={[styles.iconBtn, optOpen && { borderColor: modeMeta.color, backgroundColor: modeMeta.color + "26" }]}
          onPress={() => setOptOpen((v) => !v)}>
          <Ionicons name="options-outline" size={18} color={optOpen ? modeMeta.color : colors.textSecondary} />
        </Pressable>

        {/* ส่ง */}
        <Pressable style={[styles.send, (busy || !question.trim()) && { opacity: 0.45 }]}
          onPress={() => ask(question)} disabled={busy || !question.trim()}>
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
      </View>
    </View>

    {/* ขยายโจทย์เต็มจอ — อ่านสบาย เหมือนกระดาษใบโจทย์ */}
      <Modal visible={zoom} animationType="slide" transparent onRequestClose={() => setZoom(false)}>
        <Pressable style={styles.backdrop} onPress={() => setZoom(false)} />
        <View style={styles.zoomSheet}>
          <View style={styles.zoomHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.zoomTitle}>โจทย์</Text>
              <Text style={font.caption} numberOfLines={1}>{problem?.source?.title || ""}</Text>
            </View>
            <Pressable onPress={() => setZoom(false)}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator>
            <View style={styles.probBox}>
              <RichText text={problem?.problem || ""} tone="dark" />
            </View>
          </ScrollView>
          <Button onPress={() => { setZoom(false); setTab("chat"); }} variant="secondary" icon="chatbubbles-outline">ถามอาจารย์ AI</Button>
        </View>
      </Modal>

      {/* ============ เลือกวิชา ============ */}
    <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
      <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)} />
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>เลือกวิชา ({subjects.length})</Text>
          <Pressable onPress={() => setPickerOpen(false)}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>
        </View>
        <TextInput value={q} onChangeText={setQ} placeholder="ค้นหาชื่อวิชา..." placeholderTextColor={colors.textMuted} style={styles.search} autoFocus />
        <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
          {filtered.map((s: any) => {
            const on = s.id === subjectId;
            return <Pressable key={s.id} style={[styles.row, on && styles.rowOn]}
              onPress={() => { setSubjectId(s.id); resetOnboarding(); setFocusTopics([]); setPlan(null); setPickerOpen(false); setPickStage(false); setPullStyle(""); }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowName, on && { color: "#fff" }]} numberOfLines={2}>{s.name}</Text>
                <Text style={[styles.rowMeta, on && { color: "#ede9fe" }]}>{s._count?.materials || 0} ไฟล์</Text>
              </View>
              {on ? <Ionicons name="checkmark-circle" size={20} color="#fff" /> : null}
            </Pressable>;
          })}
          {!filtered.length ? <Text style={[font.caption, { padding: 14 }]}>ไม่พบวิชาที่ค้นหา</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}

/* ใช้ Alert ของ RN แบบย่อ เพื่อไม่ต้อง import ทั้งชุด */
function Alert2(title: string, msg?: string) {
  Alert.alert(title, msg);
}

/* ================================================================== */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  /* แถบบน */
  topBar: {
    paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 9,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 9 },
  nowTab: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9, backgroundColor: colors.accent + "26", borderWidth: 1, borderColor: colors.accent + "66" },
  nowTabText: { fontSize: 10.5, fontWeight: "900", color: colors.accent },
  brand: { fontSize: 9.5, fontWeight: "900", letterSpacing: 1.6, color: "#a78bfa" },
  topTitle: { fontSize: 19, fontWeight: "900", color: colors.text },
  subjectCard: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 10,
    borderRadius: 15, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  subjectHit: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  levelHit: { paddingVertical: 4, borderRadius: 999 },
  subjectIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#a78bfa1f", alignItems: "center", justifyContent: "center" },
  subjectLabel: { fontSize: 9.5, fontWeight: "900", color: colors.textMuted },
  subjectName: { fontSize: 14, fontWeight: "900", color: colors.text, marginTop: 1 },
  changeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
    paddingVertical: 6, borderRadius: 10, backgroundColor: "#a78bfa1f",
  },
  changeText: { fontSize: 10.5, fontWeight: "900", color: "#a78bfa" },

  /* ระดับความยาก — ชั้นใหม่ */
  segRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9 },
  segLabel: { fontSize: 9.5, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.6, width: 30 },
  seg: { flex: 1, flexDirection: "row", gap: 6 },
  segItem: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    paddingVertical: 7, paddingHorizontal: 6, borderRadius: 12,
    backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border,
  },
  segText: { fontSize: 12.5, fontWeight: "900", color: colors.text },
  segHint: { fontSize: 9, color: colors.textMuted, marginTop: 1 },

  /* แท็บ */
  tabs: { flexDirection: "row", gap: 6, marginTop: 9 },
  tab: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: colors.border,
  },
  tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { fontSize: 12, fontWeight: "800", color: colors.textMuted },

  content: { padding: spacing.lg, paddingBottom: 24, maxWidth: 860, alignSelf: "center", width: "100%" },
  panel: { marginBottom: 12 },

  /* onboarding */
  wantGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 14 },
  wantCard: {
    width: "47.5%", flexGrow: 1, minWidth: 140, padding: 13, borderRadius: 16,
    backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border,
  },
  wantIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 9 },
  wantLabel: { fontSize: 13.5, fontWeight: "900", color: colors.text },
  wantSub: { fontSize: 11, color: colors.textMuted, marginTop: 3 },

  optRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  ghostBtn: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 14, marginTop: 6 },
  ghostText: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textDecorationLine: "underline" },
  /* กล่องใบ้ทีละบรรทัด — แยกจากช่องตอบให้ชัดว่าไม่ใช่คำตอบของผู้เรียน */
  hintBox: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: "#fbbf2410", borderWidth: 1, borderColor: "#fbbf2455" },
  hintHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintHeadText: { fontSize: 12, fontWeight: "900", color: "#fbbf24" },
  hintNote: { fontSize: 11, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  /* บทวิเคราะห์โจทย์ (แยกจากโจทย์ — กดดูเอง) */
  analysisBox: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: "#fbbf2410", borderWidth: 1, borderColor: "#fbbf2455" },
  analysisH: { fontSize: 12, fontWeight: "900", color: "#fbbf24", marginTop: 10, marginBottom: 2 },
  analysisRow: { flexDirection: "row", gap: 7, marginTop: 3 },
  analysisDot: { fontSize: 13, color: "#fbbf24", lineHeight: 19 },
  analysisItem: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },
  analysisCode: { marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: colors.codeBg, borderWidth: 1, borderColor: colors.border },
  analysisCodeLine: { fontFamily: MONO.fontFamily, fontSize: 12.5, color: "#e6edf3", lineHeight: 19 },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  miniBtnText: { fontSize: 11, fontWeight: "900", color: colors.textSecondary },
  miniStart: { backgroundColor: "#34d399", borderColor: "#34d399" },
  miniSkip: { backgroundColor: "#94a3b8", borderColor: "#94a3b8" },
  recommendBox: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: "#a78bfa14", borderWidth: 1, borderColor: "#a78bfa55" },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 11, borderRadius: 12, backgroundColor: colors.surfaceAlt },
  topicNum: { width: 26, height: 26, borderRadius: 9, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  topicNumText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  /* ข้อความ */
  banner: { marginBottom: 12 },
  bannerTitle: { fontSize: 14, fontWeight: "900", color: "#fff" },
  bannerText: { fontSize: 12.5, color: "#e9d5fd", marginTop: 5, lineHeight: 19 },
  bubble: { maxWidth: "92%", marginBottom: 12, padding: 13, borderRadius: 18 },
  bubbleMe: { alignSelf: "flex-end", backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  bubbleAi: { alignSelf: "flex-start", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 6 },
  textMe: { color: "#fff", fontSize: 14, lineHeight: 22, fontWeight: "600" },
  mdText: { color: colors.text, fontSize: 14, lineHeight: 23 },
  mdTextPaper: { color: "#1e293b", fontSize: 15, lineHeight: 27 },
  mdBoxPaper: { color: "#16a34a", fontSize: 14, lineHeight: 27, width: 16 },
  mdBold: { fontWeight: "900", color: colors.text },
  mdItalic: { fontStyle: "italic", color: colors.textSecondary },
  mdCode: { fontFamily: "Consolas, Menlo, Monaco, monospace", color: "#e6edf3", backgroundColor: colors.codeBg },
  mdHead: { color: colors.text, fontWeight: "900", marginBottom: 4 },
  mdBulletRow: { flexDirection: "row", gap: 9, alignItems: "flex-start", marginBottom: 3 },
  mdDot: { color: colors.accent, fontSize: 15, lineHeight: 23, width: 12, textAlign: "center" },
  mdNum: { color: "#1d4ed8", fontSize: 13, fontWeight: "900", lineHeight: 23, width: 20 },
  mdBox: { color: "#047857", fontSize: 14, lineHeight: 23, width: 16 },
  cursor: { color: colors.accent, fontWeight: "900" },

  codeBox: {
    backgroundColor: colors.codeBg, borderRadius: 14, marginVertical: 10, overflow: "hidden",
    borderWidth: 1, borderColor: colors.codeBorder, maxWidth: "100%",
  },
  codeHead: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.codeBar, borderBottomWidth: 1, borderBottomColor: colors.codeBorder,
  },
  codeDots: { flexDirection: "row", gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  codeLang: { fontSize: 10.5, fontWeight: "900", color: colors.codeMuted, letterSpacing: 0.6 },
  block: {},
  afterCode: { paddingLeft: 11, borderLeftWidth: 2, borderLeftColor: "#a78bfa66" },
  diagramBox: {
    backgroundColor: colors.codeBg, borderRadius: 14, marginVertical: 10, overflow: "hidden",
    borderWidth: 1, borderColor: "#a78bfa55", maxWidth: "100%",
  },
  diagramHead: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: colors.codeBar, borderBottomWidth: 1, borderBottomColor: "#a78bfa33",
  },
  diagramTag: { fontSize: 10, fontWeight: "900", color: "#a78bfa", letterSpacing: 0.6 },

  sources: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 7 },
  srcTitle: { fontSize: 10, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.4 },
  src: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  // รายการที่กดไม่ได้ = ไม่มีลิงก์ ต้องดูต่างจากของที่เปิดได้
  srcPlain: { opacity: 0.82, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff" },
  srcName: { fontSize: 12, fontWeight: "800", color: colors.text },
  srcMeta: { fontSize: 10.5, color: colors.textMuted, marginTop: 1 },
  voiceRow: { flexDirection: "row", gap: 7, marginTop: 10, flexWrap: "wrap", alignItems: "center" },
  voice: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  voiceText: { fontSize: 10.5, fontWeight: "800", color: colors.textSecondary },
  thinking: { flexDirection: "row", alignItems: "center", gap: 9, padding: 12, marginBottom: 12 },

  /* ข้อสอบ */
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  /* ตัวแก้โค้ด */
  editor: {
    marginTop: 12, borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: colors.codeBorder, backgroundColor: colors.codeBg,
  },
  editorBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.codeBar,
    borderBottomWidth: 1, borderBottomColor: colors.codeBorder,
  },
  editorLang: { fontSize: 10.5, fontWeight: "900", color: colors.codeMuted, letterSpacing: 0.5 },
  editorMeta: { fontSize: 10, fontWeight: "700", color: colors.codeMuted },
  editorWrap: { position: "relative", height: 300, overflow: "hidden" },
  // ห้าม overflow:hidden ที่ชั้นนี้ เพราะการเลื่อนจะเลื่อน "กรอบตัวเอง" ออกไปด้วย
  // ต้องให้ editorWrap (พ่อ) เป็นคนตัดอย่างเดียว ไม่งั้นโค้ดท้าย ๆ จะหายไปทั้งหมด
  editorLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "visible" },
  editorText: editorTextStyle,
  editorInput: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    color: "transparent", overflowY: "auto", overflowX: "auto",
  },
  editorLayerText: { width: "max-content", minWidth: "100%" } as any,
  editorJump: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: "#a78bfa22", borderWidth: 1, borderColor: "#a78bfa55" },
  editorJumpText: { fontSize: 9.5, fontWeight: "900", color: "#a78bfa" },
  editorPos: { fontSize: 9.5, fontWeight: "900", color: "#f0abfc", letterSpacing: 0.2 },
  /* โจทย์ */
  probHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  miniAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  miniActionText: { fontSize: 10.5, fontWeight: "800", color: colors.textSecondary },
  /* ขยายเต็มจอ */
  zoomSheet: { backgroundColor: colors.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingBottom: 30, gap: 12, borderTopWidth: 1, borderColor: colors.border },
  zoomHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  zoomTitle: { fontSize: 19, fontWeight: "900", color: colors.text },
  zoomNeed: { marginBottom: 12, padding: 11, borderRadius: 12, backgroundColor: "#fbbf2412", borderWidth: 1, borderColor: "#fbbf2455" },
  zoomNeedTitle: { fontSize: 11.5, fontWeight: "900", color: "#fbbf24", marginBottom: 4 },
  zoomNeedText: { fontSize: 13, color: "#1e293b", marginTop: 2 },
  needBox: { marginBottom: 12, padding: 12, borderRadius: 13, backgroundColor: "#fbbf2412", borderWidth: 1, borderColor: "#fbbf2455" },
  srcRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  srcChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  srcChipOn: { backgroundColor: "#38bdf81f", borderColor: "#38bdf8" },
  srcChipText: { fontSize: 11, fontWeight: "800", color: colors.textSecondary },
  needTitle: { fontSize: 12, fontWeight: "900", color: "#fbbf24" },
  needRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 4 },
  needBox2: { width: 20, height: 20, borderRadius: 7, borderWidth: 1.5, borderColor: "#fbbf24", alignItems: "center", justifyContent: "center" },
  needBoxOn: { backgroundColor: "#fbbf24", borderColor: "#fbbf24" },
  needText: { flex: 1, fontSize: 12.5, fontWeight: "700", color: colors.text },
  probCount: { fontSize: 10, fontWeight: "800", color: colors.textMuted },
  /* โจทย์ — จัดเป็นกระดาษอ่านสบาย */
  probBox: {
    padding: 16, borderRadius: 16, backgroundColor: "#f8fafc",
    borderWidth: 1, borderColor: "#cbd5e1",
  },
  /* ตาราง */
  tableWrap: { marginVertical: 4 },
  table: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, overflow: "hidden", backgroundColor: "#fff" },
  tr: { flexDirection: "row" },
  thead: { backgroundColor: "#e2e8f0" },
  trAlt: { backgroundColor: "#f1f5f9" },
  th: { padding: 9, fontSize: 12.5, fontWeight: "900", color: "#0f172a" },
  td: { padding: 9, fontSize: 12.5, color: "#1e293b", lineHeight: 19 },
  ansInput: {
    marginTop: 12, minHeight: 96, borderRadius: 13, padding: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
    color: colors.text, textAlignVertical: "top", fontSize: 13.5,
  },
  missingBox: { marginBottom: 10, padding: 11, borderRadius: 12, backgroundColor: "#fbbf2414", borderWidth: 1, borderColor: "#fbbf2466" },
  missingTitle: { fontSize: 12.5, fontWeight: "900", color: "#fbbf24", marginBottom: 4 },
  missingText: { fontSize: 12, color: colors.text, marginTop: 2 },
  verdict: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
    borderRadius: 13, borderWidth: 1.5,
  },
  verdictOk: { backgroundColor: "#34d3991a", borderColor: "#34d399" },
  verdictBad: { backgroundColor: "#f43f5e1a", borderColor: "#f43f5e" },
  verdictTitle: { fontSize: 17, fontWeight: "900" },
  markBox: {
    marginTop: 14, padding: 13, borderRadius: 13,
    backgroundColor: "#a78bfa12", borderWidth: 1, borderColor: "#a78bfa55",
  },
  markTitle: { fontSize: 13.5, fontWeight: "900", color: "#fff", marginBottom: 2 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  hrLabel: { fontSize: 11, fontWeight: "900", color: colors.textMuted, textAlign: "center", marginBottom: 12 },
  sylGroup: { fontSize: 10.5, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.6 },
  chipOn: { backgroundColor: "#38bdf8", borderColor: "#38bdf8" },
  chipText: { fontSize: 11, fontWeight: "800", color: colors.textSecondary },
  progressWrap: { gap: 7, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceAlt },
  progressBar: { height: 7, borderRadius: 4, backgroundColor: colors.surface, overflow: "hidden" },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: colors.accent },
  qCard: { marginBottom: 0 },
  qNum: { fontSize: 10.5, fontWeight: "900", color: colors.accent, marginBottom: 6 },
  opt: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
  optOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  optText: { flex: 1, fontSize: 13.5, color: colors.text },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: "#fff" },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#fff" },
  score: { fontSize: 46, fontWeight: "900" },
  recTitle: { fontSize: 14, fontWeight: "900", color: "#fff", marginBottom: 6 },
  badgeGood: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: "#34d3991f" },
  badgeBad: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: "#f43f5e1f" },
  badgeGoodText: { fontSize: 12, fontWeight: "700", color: "#34d399" },
  badgeBadText: { fontSize: 12, fontWeight: "700", color: "#f43f5e" },
  reviewRow: { flexDirection: "row", gap: 10, padding: 11, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  reviewOk: { borderColor: "#34d399" },
  reviewBad: { borderColor: "#f43f5e" },

  /* ช่องพิม — รวมทุกฟังก์ชันไว้แถบเดียว */
  composerWrap: { paddingHorizontal: spacing.lg, paddingBottom: 84, backgroundColor: colors.background, position: "relative" },
  barAnchor: { position: "relative", maxWidth: 860, width: "100%", alignSelf: "center" },
  bar: {
    flexDirection: "row", alignItems: "center", gap: 5,
    maxWidth: 860, width: "100%", alignSelf: "center",
    padding: 5, borderRadius: 17,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  input: {
    flex: 1, minHeight: 34, maxHeight: 96,
    paddingHorizontal: 8, paddingVertical: 7,
    color: colors.text, backgroundColor: "transparent", textAlignVertical: "center",
  },
  send: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },

  /* เมนูเล็ก — ชิดขวา กดแล้วเลือกได้ ไม่กินพื้นที่ */
  popBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  pop: {
    // 110 ไม่ใช่ 70: composerWrap มี paddingBottom 84 อยู่แล้ว ถ้ายกน้อยกว่านี้
    // ขอบล่างของเมนูจะจมอยู่ใต้แถบแท็บบาร์จนต้องเลื่อนเองถึงจะเห็นรายการสุดท้าย
    position: "absolute", right: 0, bottom: 110,
    width: 236, paddingVertical: 8, paddingHorizontal: 8,
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 18, elevation: 14,
  },
  popHead: { fontSize: 9.5, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.6, marginBottom: 5, marginLeft: 4 },
  popCol: { gap: 3 },
  popItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 9, height: 34, borderRadius: 10,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },
  popItemText: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, minWidth: 52 },
  popItemHint: { flex: 1, fontSize: 10, color: colors.textMuted },
  popDivider: { height: 1, backgroundColor: colors.border, marginVertical: 7, marginHorizontal: 4 },

  /* ชีต */
  backdrop: { flex: 1, backgroundColor: "#000000aa" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingBottom: 30, gap: 12, borderTopWidth: 1, borderColor: colors.border },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: colors.text },
  sheetLabel: { fontSize: 10.5, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  optGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optCard: { width: "31%", flexGrow: 1, minWidth: 104, padding: 12, borderRadius: 15, backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border },
  optCardLabel: { fontSize: 13, fontWeight: "900", color: colors.text, marginTop: 8 },
  optCardHint: { fontSize: 10.5, color: colors.textMuted, marginTop: 3 },
  speedRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 13, backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border },
  speedLabel: { fontSize: 13.5, fontWeight: "900", color: colors.text },
  speedHint: { flex: 1, fontSize: 11, color: colors.textMuted, textAlign: "right" },
  toggle: { width: 40, height: 22, borderRadius: 11, backgroundColor: colors.border, padding: 3, justifyContent: "center" },
  toggleOn: { backgroundColor: colors.accent },
  toggleDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" },
  search: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, color: colors.text, backgroundColor: colors.surfaceAlt },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 14, backgroundColor: colors.surfaceAlt, marginBottom: 8 },
  rowOn: { backgroundColor: colors.accent },
  rowName: { fontSize: 13, fontWeight: "800", color: colors.text },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
