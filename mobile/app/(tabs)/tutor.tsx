import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { colors, font, spacing } from "../../lib/theme";
import { Alert } from "../../lib/alert";
import { Button, Card, GlowCard, Pill } from "../../lib/ui";
import FlowchartBuilder from "../../components/FlowchartBuilder";
import MermaidFlow from "../../components/MermaidFlow";
import {
  BASE_URL, getSubjects, tutorAnalyze, tutorAskStream, tutorCheckAnswer, tutorDiagnose, tutorEvaluate,
  tutorFiles, tutorOpen, tutorPlan, tutorPracticeHint, tutorCodeSolution, tutorProblem, tutorProblemVariant, tutorStudyPlan, tutorTts, tutorTopics,
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
  { k: "normal", label: "ง่าย", hint: "จำและเข้าใจ", color: "#34d399" },
  { k: "high", label: "ปานกลาง", hint: "ประยุกต์ใช้", color: "#f59e0b" },
  { k: "deep", label: "ยาก", hint: "วิเคราะห์", color: "#f43f5e" },
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
  const syncScroll = useCallback((e?: any) => {
    // อ่านค่าจาก event เท่านั้น — การอ่าน scrollTop จาก ref บน RNW ได้ค่าที่ไม่ตรงเสมอ
    // ผลคือชั้นสีไม่ขยับตาม = ผู้ใช้เลื่อนแล้วเห็นกรอบเปล่า
    const off0 = e?.nativeEvent?.contentOffset ?? e?.target;
    const y = Number(off0?.y ?? off0?.scrollTop ?? 0) || 0;
    const x = Number(off0?.x ?? off0?.scrollLeft ?? 0) || 0;
    setOff((p) => (p.x === x && p.y === y ? p : { x, y }));
    const box: any = layerRef.current;
    if (box && box.style) box.style.transform = `translate(${-x}px, ${-y}px)`;
  }, []);

  const jumpTo = useCallback((where: "top" | "bottom") => {
    const input: any = ref.current;
    if (!input) return;
    const max = Math.max(0, (input.scrollHeight || 0) - (input.clientHeight || 300));
    const y = where === "bottom" ? max : 0;
    input.scrollTop = y;
    input.scrollLeft = 0;
    // ส่งค่าให้ชั้นสีโดยตรง ไม่รอให้ onScroll ปาดมา (บางครั้งไม่ยิงตอนกำหนดค่าเอง)
    syncScroll({ nativeEvent: { contentOffset: { x: 0, y } } });
  }, [syncScroll]);
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
    if (!value) {
      const timer = setTimeout(() => syncScroll({ nativeEvent: { contentOffset: { x: 0, y: 0 } } }), 0);
      timers.current.push(timer);
      return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    }
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
  }, [value, jumpTo, syncScroll]);

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
type Fmt = "text" | "options" | "code" | "flowchart" | "diagram" | "table" | "pseudocode" | "translate" | "cloze";
const FORMATS: { k: Fmt; label: string; icon: string; hint: string }[] = [
  { k: "text", label: "ข้อความ", icon: "document-text-outline", hint: "ตอบเป็นข้อความ" },
  { k: "options", label: "ตัวเลือก", icon: "list-outline", hint: "A B C ง" },
  { k: "code", label: "โค้ด", icon: "code-slash-outline", hint: "เขียนเป็นโปรแกรม" },
  { k: "flowchart", label: "ผังภาพ", icon: "git-branch-outline", hint: "flowchart" },
  { k: "diagram", label: "แผนผัง", icon: "grid-outline", hint: "ผังงาน/โครงสร้าง" },
  { k: "table", label: "ตาราง", icon: "grid-outline", hint: "เทียบข้อมูล" },
  { k: "pseudocode", label: "รหัสเทียม", icon: "terminal-outline", hint: "pseudocode" },
  { k: "translate", label: "แปลประโยค", icon: "language-outline", hint: "ไทย ↔ อังกฤษ" },
  { k: "cloze", label: "เติมคำตอบ", icon: "create-outline", hint: "เติมคำ/ประโยคในช่องว่าง" },
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
  // ดอกจันเดี่ยวใช้เป็นตัวเอียงได้ แต่ต้องไม่ใช่เครื่องหมายคูณในโค้ด (เช่น `price * 0.10`)
  // จึงกำหนดว่าเปิดด้วย * ที่ตามหลังด้วยอักขระจริง (ไม่ใช่ช่องว่าง) และปิดด้วย * ที่ตามด้วยอักขระที่ไม่ใช่คำ
  const parts = String(s).split(/(\*\*[^*]+\*\*|\*(?!\s)[^*\n]*?[^\s*]\*|`[^`]+`|\$[^$\n]+\$)/g).filter((x) => x !== "");
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

const voiceCache = new Map<string, string>();

/* ---- เล่นเสียงผ่าน <audio> ตัวเดียว ----
   iOS Safari ไม่อนุญาตให้ play() หลัง await ถ้ายังไม่เคยเล่นจาก gesture ของผู้ใช้
   เดิมจึงตกไปใช้เสียง Siri บางครั้ง บางครั้งได้เสียง Gemini → เสียงสลับไปมา
   วิธีแก้: ปลดล็อก audio element ในจังหวะกดปุ่ม แล้วใช้ตัวเดิมตลอด */
let audioEl: any = null;
let audioUnlocked = false;
let silentWav: string | null = null;
/** สร้าง WAV เงียบสั้น ๆ ไว้ปลดล็อกเสียง iOS (ไม่ต้องฝัง base64 ยาว ๆ) */
function silentWavUrl() {
  if (silentWav) return silentWav;
  const n = 400, sr = 8000;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  put(0, "RIFF"); v.setUint32(4, 36 + n, true); put(8, "WAVE"); put(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  put(36, "data"); v.setUint32(40, n, true);
  const bytes = new Uint8Array(buf);
  for (let i = 44; i < bytes.length; i++) bytes[i] = 128;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  silentWav = "data:audio/wav;base64," + btoa(bin);
  return silentWav;
}

function getAudio() {
  if (!audioEl && typeof window !== "undefined") {
    audioEl = new Audio();
    audioEl.playsInline = true;
    audioEl.preload = "auto";
  }
  return audioEl;
}

/** ต้องเรียกก่อน await ทุกครั้งที่ผู้ใช้กดปุ่ม (ปลดล็อกเสียงให้ iOS) */
function unlockAudio() {
  const a = getAudio();
  if (!a || audioUnlocked) return;
  try {
    a.src = silentWavUrl();
    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        audioUnlocked = true;
        if (String(a.src).startsWith("data:audio/wav")) { try { a.pause(); } catch { } }
      }).catch(() => { });
    } else {
      audioUnlocked = true;
    }
  } catch { }
}

async function playUrl(url: string) {
  const a = getAudio();
  if (!a) throw new Error("เล่นเสียงไม่ได้");
  a.src = url;
  a.currentTime = 0;
  await a.play();
}

/** ล็อกเสียงสำรอง (Siri/เบราว์เซอร์) ไว้ตัวเดียว ไม่ให้เปลี่ยนไปตามระบบ */
let pinnedVoice: any = null;
function pickThaiVoice(w: any) {
  if (pinnedVoice) return pinnedVoice;
  const all: any[] = (w?.speechSynthesis?.getVoices?.() || []).slice();
  const thai = all.filter((v) => /^th([-_]|$)/i.test(String(v.lang || "")));
  thai.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  pinnedVoice = thai.find((v) => /siri/i.test(v.name)) || thai.find((v) => /kanya/i.test(v.name)) || thai[0] || null;
  return pinnedVoice;
}

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

/* ถ้าเสียงจากเซิร์ฟเวอร์ใช้ไม่ได้ (เช่น quota หมด) ให้ใช้เสียงสำรอง "ตัวเดิม" ตลอด session
   จะได้ไม่สลับไปมาระหว่างเสียง Gemini กับเสียง Siri ทีละข้อความ */
let preferBrowser = false;

async function speak(text: string) {
  const w: any = typeof window !== "undefined" ? window : null;
  const clean = spokenText(text);
  if (!w || !clean) return;
  stopSpeak();     // หยุดเสียงเดิมก่อน
  unlockAudio();   // ต้องอยู่ก่อน await เพื่อให้ iOS ยอมเล่นเสียง
  if (preferBrowser) { fallbackSpeak(w, clean); return; }
  const key = clean.slice(0, 160);
  const cached = voiceCache.get(key);
  if (cached) {
    try { await playUrl(`${BASE_URL}${cached}`); return; } catch { }
  }
  try {
    const r: any = await tutorTts(clean);
    if (!r?.url) throw new Error("ไม่ได้รับลิงก์เสียง");
    voiceCache.set(key, r.url);
    await playUrl(`${BASE_URL}${r.url}`);
    return;
  } catch {
    preferBrowser = true;
    fallbackSpeak(w, clean);
  }
}

function fallbackSpeak(w: any, clean: string) {
  const synth = w?.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const text = clean.replace(/[#*`>_|]/g, " ").replace(/\n{2,}/g, ". ").replace(/\n/g, ". ").slice(0, 1200);
  const speakNow = () => {
    const u = new w.SpeechSynthesisUtterance(text);
    u.lang = "th-TH";
    u.rate = 0.95;
    u.pitch = 1;
    const v = pickThaiVoice(w);
    if (v) { u.voice = v; if (v.lang) u.lang = v.lang; }
    synth.speak(u);
  };
  // บางเบราว์เซอร์ (โดยเฉพาะ iOS) โหลดรายการเสียงไม่ทันครั้งแรก
  if ((synth.getVoices?.() || []).length) { speakNow(); return; }
  let done = false;
  const once = () => { if (done) return; done = true; speakNow(); };
  try { synth.addEventListener("voiceschanged", once, { once: true } as any); } catch { }
  setTimeout(once, 800);
}

function stopSpeak() {
  const w: any = typeof window !== "undefined" ? window : null;
  const a = getAudio();
  if (a) { try { a.pause(); } catch { } }
  if (w?.speechSynthesis) w.speechSynthesis.cancel();
}

/* ================================================================== */

type Msg = { role: "me" | "ai"; text: string; sources?: any[]; usedModel?: boolean; grounded?: boolean; casual?: boolean; streaming?: boolean };

export default function Tutor() {
  const routeParams = useLocalSearchParams<{ subjectId?: string; tab?: string; action?: string }>();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const routeActionHandled = useRef("");
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
  const [photoAnswers, setPhotoAnswers] = useState<Record<number, ImagePicker.ImagePickerAsset>>({});
  const [quizBusy, setQuizBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [quizSourceMode, setQuizSourceMode] = useState<"source" | "new">("source");
  const [quizMaterialId, setQuizMaterialId] = useState("");
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
  }, [subjectId, sylFor]);

  /* --- เลือก "ไฟล์ต้นทาง" + "ระดับความยาก" — ใช้กับทุกแนวข้อสอบ ---
     ระดับอิงลำดับไฟล์ใน Classroom: ไฟล์ต้น (บทแรก/สัปดาห์แรก) = ง่าย ไฟล์ท้าย = ยาก
     ไม่เลือกไฟล์ = ทั้งวิชา, ไม่เลือกระดับ = ระบบเรียงง่ายก่อนให้เอง */
  const [pickFile, setPickFile] = useState<string>("");
  const [pickLevel, setPickLevel] = useState<"" | "easy" | "medium" | "hard">("");
  const [fileList, setFileList] = useState<any[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [filesFor, setFilesFor] = useState("");

  /** รายชื่อไฟล์ในวิชา + จำนวนโจทย์ + ระดับยากง่าย (เปลี่ยนวิชาแล้วดึงใหม่) */
  useEffect(() => {
    if (!subjectId || filesFor === subjectId) return;
    let alive = true;
    setFileBusy(true);
    setFileList([]);
    setPickFile("");   // ไฟล์ที่เลือกไว้เป็นของวิชาเก่า = ล้างทิ้ง
    setPickLevel("");
    setQuizMaterialId("");
    setQuizSourceMode("source");
    tutorFiles(subjectId)
      .then((r: any) => { if (alive) { setFileList(r.files || []); setFilesFor(subjectId); } })
      .catch(() => { if (alive) { setFileList([]); setFilesFor(subjectId); } })
      .finally(() => { if (alive) setFileBusy(false); });
    return () => { alive = false; };
  }, [subjectId, filesFor]);

  /* --- ระบบข้อสอบ: ดึงโจทย์จริงจากในวิชา + เลือกรูปแบบคำตอบ --- */
  // รูปแบบคำตอบไม่ให้ผู้ใช้เลือกเองแล้ว (ซ้ำกับโหมดในเมนู) ให้เซร์ฟเวอร์เลือกตามโจทย์
  const [problem, setProblem] = useState<any>(null);
  const [probBusy, setProbBusy] = useState(false);
  const [probErr, setProbErr] = useState("");
  // คำแนะนำเพิ่มเติมจากเซิร์ฟเวอร์ (เช่น "วิชานี้ไม่มีแบบฝึกหัด — ลองแปลประโยคหรือเลือกวิชาอื่น")
  const [probHint, setProbHint] = useState("");
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
  // คำใบ้โหมดฝึกทำรหัสเทียม — เก็บทีละข้อ ใบ้ลึกขึ้นเรื่อย ๆ ไม่สอดเฉลยลงช่อง (คนละระบบกับ hintLines ด้านบน)
  const [practiceHints, setPracticeHints] = useState<string[]>([]);
  const [psuHintBusy, setPsuHintBusy] = useState(false);
  // วิเคราะห์โจทย์ (Input/Output/Process/ตัวแปร/ค่าเริ่มต้น/รหัสเทียม) — แยกจากตัวโจทย์
  // ผู้เรียนกดปุ่มเองตอนอยากดูแนวทาง โจทย์จะไม่มีส่วนวิเคราะห์ปนอยู่เด็ดขาด
  type Analysis = { input: string[]; output: string[]; process: string[]; variables: string[]; initial: string[]; pseudocode: string };
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [doneItems, setDoneItems] = useState<string[]>([]);
  const [, setMissing] = useState<string[]>([]);
  const [zoom, setZoom] = useState(false);
  const [src, setSrc] = useState<"class" | "submission">("class");
  // หน้าเลือกก่อนดึงโจทย์ — กด "ดึงโจทย์" แล้วขึ้นมาให้เลือก "แนวไหน + หัวข้อไหน" ก่อนสุ่มจริง
  const [pickStage, setPickStage] = useState(false);
  // โหมดย่อยของหน้าข้อสอบ — "pull" = ดึงโจทย์ (หน้าปกติ), "quiz" = วินิจฉัยอัตโนมัติ
  // แยกออกจากกันตามที่สั่ง: หน้าข้อสอบใหญ่เหลือแค่ดึงโจทย์ล้วน
  // วินิจฉัยอัตโนมัติเข้าจาก popup เลือก做完อะไร ตอนกดเข้าแท็บข้อสอบ (ไม่อยู่ในเมนูแล้ว)
  const [diagStage, setDiagStage] = useState<"pull" | "quiz">("pull");
  // popup เลือกว่าจะเข้าทำอะไรในโหมดข้อสอบ — เด้งตอนกดเข้าแท็บ "ข้อสอบ" จากเมนู
  const [examPick, setExamPick] = useState(false);
  // แนวโจทย์ที่เลือกในหน้าเลือก — "เก็บไว้เฉพาะรอบดึงนี้" ห้ามผูกกับโหมดหลัก (mode)
  // เพราะเปลี่ยนโหมดหลัก = เปลี่ยนทั้งหน้าจอ (แชต/เมนู/โจทย์อัตโนมัติ) ตามที่ผู้ใช้สั่งห้าม
  // "" = ทั่วไป (ระบบเลือกฟอร์แมตเอง), "code"/"options" = เลือกจากหน้าเลือก
  // "flowchart"/"pseudocode"/"table"/"random" = ตั้งจาก popup เลือกตอนเข้าแท็บข้อสอบ (สุ่มทุกอย่าง)
  const [pullStyle, setPullStyle] = useState<string>("");
  const [focusedPractice, setFocusedPractice] = useState(false);

  const fmt: Fmt = ((problem?.format as Fmt) || "text") as Fmt;
  const fmtMeta = FORMATS.find((f) => f.k === fmt) || FORMATS[0];
  /**
   * โหมดฝึกทำรหัสเทียม — เลือก "รหัสเทียม" จาก popup ข้อสอบแล้ว:
   * หน้ามีแค่ โจทย์ (ดึงจากไฟล์จริง) + ช่องเขียนมีเลขบรรทัด + ตรวจคำตอบ + ข้อถัดไป (ตอนถูก)
   * ซ่อนแถบเลือกแนว/ปุ่มสุ่ม/โจทย์ซ้อน/ถาม AI/วิเคราะห์ — เพราะผลวิเคราะห์มีส่วน
   * "รหัสเทียม" ที่เป็นเฉลยข้อนั้น ถ้าเปิดดูได้ตอนฝึก = เห็นเฉลยตั้งแต่ก่อนทำ
   */
  const practice = focusedPractice;
  const pseudoPractice = practice && pullStyle === "pseudocode";
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
    const taskForHint = problem.problem;
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
      const response = await tutorCodeSolution(subjectId, taskForHint, myAnswer, String(problem.source?.materialId || ""));
      const rawCode = String(response?.code || "");
      const block = rawCode.match(/```[a-zA-Z+#]*\s*\n?([\s\S]*?)```/);
      const clean = block ? block[1] : rawCode;
      const lines = relocateComments(trimTail(stripLoose(clean)).split("\n"));
      if (!lines.join("").trim()) throw new Error("ยังสร้างโค้ดสำหรับโจทย์ข้อนี้ไม่ได้ ลองอีกครั้ง");
      setHintLines(lines);
      setHintShown(1);
      insertHintLines([lines[0]]);
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
  /** คำใบ้โหมดฝึกทำรหัสเทียม — AI ใบ้ขั้นถัดไป ไม่บอกเฉลย ไม่สอดอะไรลงช่อง
   *  กดซ้ำได้เรื่อย ๆ โดยส่งคำใบ้เดิมไปด้วย เพื่อให้ใบ้ถัดไปลึกขึ้นและไม่ซ้ำ */
  async function fetchPracticeHint() {
    if (!problem) return;
    setPsuHintBusy(true);
    try {
      const r = await tutorPracticeHint(subjectId, problem.problem, myAnswer, practiceHints);
      if (r?.hint) setPracticeHints((h) => [...h, String(r.hint)]);
      else Alert2("ยังขอใบ้ไม่ได้", "AI ไม่ส่งคำใบ้กลับมา ลองอีกครั้ง");
    } catch (e: any) {
      Alert2("ยังขอใบ้ไม่ได้", String(e?.message || e));
    } finally { setPsuHintBusy(false); }
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

  /** "สุ่มทุกอย่าง" — สุ่มฟอร์แมตใหม่ทุกครั้งที่ดึง โค้ด/รหัสเทียมสุ่มได้เฉพาะวิชาที่มีสัญญาณเขียนโปรแกรมจริง */
  function pickRandomFmt(): Fmt {
    const pool: Fmt[] = ["text", "options"];
    if (hasDiagramMode) pool.push("flowchart", "diagram");
    if (hasCompareMode || hasStepsMode) pool.push("table");
    if (hasLangMode) pool.push("translate", "cloze");
    if (hasCodeMode) pool.push("code", "pseudocode");
    return pool[Math.floor(Math.random() * pool.length)];
  }

  async function loadProblem(forceFmt?: string) {
    if (needSubject()) return;
    setProbBusy(true); setProbErr(""); setProbHint(""); setMark(null); setMyAnswer(""); setPicked(-1); setDoneItems([]); setMissing([]); resetHints(); resetAnalysis(); setPracticeHints([]);
    try {
      // แนวโจทย์จากหน้าเลือก (pullStyle) มาก่อน — เลือกที่นี่มีผลเฉพาะรอบดึงนี้ ไม่เปลี่ยนโหมดหลัก
      // "random" (สุ่มทุกอย่าง) = สุ่มฟอร์แมตใหม่เองทุกครั้งที่ดึง โค้ด/รหัสเทียมสุ่มได้เฉพาะวิชาที่มีสัญญาณโค้ด
      // ไม่ได้เลือก = ค่อยดูโหมดหลัก (โหมดโค้ดยังดึงโจทย์โค้ดเหมือนเดิม) หรือให้เซิร์ฟเวอร์เลือกเอง
      const requested = forceFmt !== undefined ? forceFmt : pullStyle;
      const useFmt = requested === "random" ? pickRandomFmt()
        : forceFmt !== undefined ? requested
          : practice ? requested : (requested || (mode === "code" ? "code" : ""));
      // focusTopics = หัวข้อที่เลือกไว้ในหน้าเลือกก่อนดึง (ไม่เลือก = ทั้งวิชา)
      // pickFile/pickLevel = ไฟล์ต้นทาง 1 ไฟล์ + ระดับความยาก (ไม่เลือก = ทั้งวิชา / เรียงง่ายก่อน)
      const r = await tutorProblem(subjectId, useFmt, seen, src, focusTopics, { materialId: pickFile, level: pickLevel });
      setProblem(r);
      // rawKey = คีย์จากข้อความดิบที่เซิร์ฟเวอร์เทียบตอนกรองข้อซ้ำ — ใช้ก่อน
      // (โจทย์ที่ AI แต่งใหม่มีคำนำหน้าต่างจากต้นฉบับ เทียบด้วยข้อความบนจอจะไม่ตรงเลย)
      if (r?.source) setSeen((s) => [...s, r.rawKey || (r.source.materialId + "|" + String(r.problem).normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 1200))].slice(-20));
      // สุ่มโจทย์ใหม่ = ต้องเห็นผลลัพธ์ทันที ไม่ใช่ถูกเลื่อนไปเอาท้ายจอ
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
    } catch (e: any) {
      setProblem(null);
      setProbErr(String(e?.message || e).replace(/^Error:\s*/, ""));
      setProbHint(String(e?.hint || ""));
    } finally { setProbBusy(false); }
  }

  // loadProblem intentionally closes over the current in-page pull settings.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const action = String(routeParams.action || "").trim();
    if (!subjectId || !action || routeActionHandled.current === subjectId + "|" + action) return;
    routeActionHandled.current = subjectId + "|" + action;
    const timer = setTimeout(() => {
      if (action === "exam") {
        setDiagStage("pull");
        setTab("diag");
        setFocusedPractice(false);
        setPullStyle("");
        setExamPick(true);
      } else if (action === "flowchart" || action === "code") {
        setDiagStage("pull");
        setTab("diag");
        setPullStyle(action);
        setFocusedPractice(true);
        setProblem(null); setMark(null); setMyAnswer(""); setPicked(-1);
        void loadProblem(action);
      } else {
        setTab("chat");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [subjectId, routeParams.action]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /** โจทย์ซ้อน: สร้างโจทย์ใหม่จากไฟล์เดียวกัน ให้ลองทำเอง — ไม่มีโค้ดตัวอย่าง */
  async function loadVariant() {
    if (needSubject()) return;
    if (!problem?.source?.materialId) { Alert2("ยังไม่มีโจทย์", "กดสุ่มโจทย์ก่อน แล้วค่อยขอโจทย์ซ้อน"); return; }
    setProbBusy(true); setProbErr(""); setProbHint(""); setMark(null); setMyAnswer(""); setPicked(-1); setDoneItems([]); setMissing([]); resetHints(); resetAnalysis(); setPracticeHints([]);
    try {
      const r = await tutorProblemVariant(subjectId, fmt || "", problem.source.materialId, pickLevel);
      setProblem(r);
      // โจทย์ซ้อนคนละข้อ = ให้ถือว่ายังไม่เคยเห็น เพื่อไม่ให้ถูกกรองออกตอนสุ่มรอบหน้า
      if (r?.source) setSeen((s) => [...s, r.source.materialId + "|" + String(r.problem).normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 1200)].slice(-20));
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
      const r = await tutorCheckAnswer(subjectId, problem.problem, myAnswer, problem.deliverables || [], doneItems, fmt);
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
  useEffect(() => {
    const requested = String(routeParams.subjectId || "").trim();
    if (!requested) return;
    setSubjectId(requested);
    if (routeParams.tab === "diag") setTab("diag");
  }, [routeParams.subjectId, routeParams.tab]);
  useEffect(() => { if (!subjectId && subjects[0]?.id) setSubjectId(subjects[0].id); }, [subjects, subjectId]);
  // เปลี่ยนวิชา = เริ่มโหมดใหม่เสมอ — กัน "โหมดโค้ด" ค้างจากวิชาก่อนหน้า
  // ไปบังคับโจทย์ของวิชาที่เนื้อหาไม่มีเขียนโค้ด (เช่น 1204102)
  useEffect(() => {const timer=setTimeout(()=>setMode("explain"),0);return()=>clearTimeout(timer)}, [subjectId]);

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
  const subjectFormats = useMemo(() => {
    const serverFormats: any[] = Array.isArray(opening?.formats) ? opening.formats : [];
    if (!serverFormats.length) return null;
    return serverFormats;
  }, [opening]);
  // ฟอร์แมตเฉพาะทางในเมนูข้อสอบให้ตรงกับเนื้อหาของวิชาที่ /open วิเคราะห์ได้
  const hasCodeMode = subjectModes.some((m) => m.k === "code");
  const hasDiagramMode = subjectModes.some((m) => m.k === "diagram");
  const hasCompareMode = subjectModes.some((m) => m.k === "compare");
  const hasStepsMode = subjectModes.some((m) => m.k === "steps");
  const hasLangMode = subjectModes.some((m) => m.k === "vocab" || m.k === "grammar");
  // สัญญาณอื่น ๆ ของวิชา — ใช้กรองแถวใน popup "จะเลือกทำอะไร?" ให้เห็นเฉพาะแนวที่เกี่ยวกับวิชานั้น
  // (มาจากรายการโหมดของ /open ที่เซิร์ฟเวอร์อ่านเนื้อหาไฟล์จริงแล้ว ไม่เดาจากชื่อวิชา)
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
  // กลุ่มตามเทอม — ไม่ค้นหา = จัดกลุ่มให้เห็นรอบที่วิชาเข้ามา, ค้นหา = แบน ๆ หาเจอง่ายกว่า
  const pickGroups = useMemo(() => {
    if (q.trim()) return [{ label: null as string | null, list: filtered }];
    const m = new Map<string, { label: string; yo: number; so: number; list: typeof subjects }>();
    for (const s of filtered) {
      const sem = s.semester, ay = sem?.academicYear;
      const k = String(sem?.id || "none");
      let g = m.get(k);
      if (!g) { g = { label: String(sem?.name || "วิชา"), yo: Number(ay?.order || 0), so: Number(sem?.order || 0), list: [] }; m.set(k, g); }
      g.list.push(s);
    }
    return [...m.values()].sort((a, b) => a.yo - b.yo || a.so - b.so).map((g) => ({ label: g.label as string | null, list: g.list }));
  }, [filtered, q]);

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
    // ส่งบทสนทนาก่อนหน้าไปด้วย เพื่อให้ถามต่อเนื่องได้เหมือน ChatGPT
    const history = messages
      .filter((m) => !m.streaming && m.text.trim())
      .slice(-8)
      .map((m) => ({ role: (m.role === "ai" ? "assistant" : "user") as "user" | "assistant", content: m.text.trim().slice(0, 1500) }));
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
        onReset: () => {
          // เซิร์ฟเวอร์เปลี่ยนโมเดลกลางทาง — ล้างข้อความที่พิมพ์ค้างไว้ก่อนเริ่มใหม่
          acc = "";
          setMessages((m) => m.map((x, i) => (i === aiIdx ? { ...x, text: "" } : x)));
        },
        onDone: (d) => {
          setMessages((m) => m.map((x, i) => (i === aiIdx ? {
            ...x, streaming: false, usedModel: d?.usedModel !== false, grounded: d?.grounded !== false, casual: !!d?.casual,
          } : x)));
          if (autoSpeak && acc.trim().length > 10) speak(spokenText(acc));
        },
        onError: (e) => setMessages((m) => m.map((x, i) => (i === aiIdx ? { ...x, streaming: false, text: x.text || ("ผิดพลาด: " + e) } : x))),
      }, history);
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
    // เริ่มข้อสอบ = ไปหน้า "วินิจฉัยอัตโนมัติ" เสมอ (ไม่ว่าจะกดมาจากแท็บไหน)
    setFocusedPractice(false);
    setPullStyle("");
    setTab("diag");
    setDiagStage("quiz");
    const focus = list?.length ? list : focusTopics;
    setQuizBusy(true); setResult(null); setQuiz(null); setPicks([]); setPhotoAnswers({});
    try {
      const r = await tutorDiagnose(subjectId, level, focus.length ? focus : undefined, {
        sourceMode: quizSourceMode,
        materialId: quizMaterialId,
      });
      setQuiz(r); setPicks(new Array(r.questions.length).fill(-1));
    } catch (e) { Alert2("สร้างข้อสอบไม่สำเร็จ", String(e)); }
    finally { setQuizBusy(false); }
  }

  async function submitQuiz() {
    if (!quiz) return;
    const unanswered = quiz.questions.some((question: any, index: number) => question.type === "SHORT_ANSWER"
      ? !photoAnswers[index]
      : picks[index] < 0);
    if (unanswered) { Alert2("ยังตอบไม่ครบ", "เลือกคำตอบหรือแนบภาพวิธีทำให้ครบทุกข้อก่อนส่ง"); return; }
    setQuizBusy(true);
    try {
      const r = await tutorEvaluate(subjectId, quiz.questions, picks, quiz.quizId, photoAnswers);
      setResult(r);
      if (r.advice) speak(spokenText(r.advice));
    } catch (e) { Alert2("ประเมินไม่สำเร็จ", String(e)); }
    finally { setQuizBusy(false); }
  }

  async function captureWrittenAnswer(questionIndex: number) {
    try {
      if (Platform.OS !== "web") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { Alert2("ยังไม่ได้อนุญาตกล้อง", "อนุญาตให้ใช้กล้องเพื่อถ่ายภาพวิธีทำ"); return; }
      }
      // Call the web camera picker directly from the user's button press so
      // browsers retain the camera/file-input activation.
      const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: false });
      if (!picked.canceled && picked.assets?.[0]) setPhotoAnswers((current) => ({ ...current, [questionIndex]: picked.assets[0] }));
    } catch (error) { Alert2("เปิดกล้องไม่ได้", String(error)); }
  }

  async function chooseWrittenAnswerPhoto(questionIndex: number) {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: false });
      if (!picked.canceled && picked.assets?.[0]) setPhotoAnswers((current) => ({ ...current, [questionIndex]: picked.assets[0] }));
    } catch (error) { Alert2("เลือกรูปไม่ได้", String(error)); }
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
              {subject?.name || (subjects.length ? "เลือกวิชา" : "ยังไม่มีวิชา")}
            </Text>
            <Pill text={`${subject?._count?.materials ?? 0} ไฟล์`} color="#38bdf8" />
          </View>
        </Pressable>
        <Pressable style={styles.levelHit} onPress={() => setOptOpen(true)}>
          <Pill text={`ความยาก: ${levelMeta.label}`} color={levelMeta.color} />
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
            <Pressable style={styles.ghostBtn} onPress={() => setStage("weak")}>
              <Text style={styles.ghostText}>ไม่แน่ใจ → ให้ช่วยประเมินจุดอ่อนให้</Text>
            </Pressable>
          </> : null}

          {stage === "weak" ? <>
            <Text style={font.h2}>คุณอ่อนด้านไหนมากที่สุด?</Text>
            <View style={{ gap: 8, marginTop: 12 }}>
              {topics.map((t: any, i: number) => <Pressable key={i} style={styles.optRow}
                onPress={() => { setWeakTopic(t.title); setStage("choose"); }}>
                <View style={styles.radio}><Ionicons name="trending-down-outline" size={16} color="#f59e0b" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={font.title}>{t.title}</Text>
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
                  {s.minutes ? <Text style={[font.caption, { color: "#38bdf8" }]}>≈ {s.minutes} นาที</Text> : null}
                </View>
              </View>)}
            </View>
            <View style={{ gap: 8, marginTop: 14 }}>
              <Button onPress={() => { setOnboardOff(true); setTab("chat"); }} variant="secondary" icon="chatbubbles-outline">ถามอาจารย์ AI ต่อ</Button>
              <Pressable style={styles.ghostBtn} onPress={resetOnboarding}><Text style={styles.ghostText}>เริ่มใหม่</Text></Pressable>
            </View>
          </> : null}
        </Card> : null}

        {opening?.empty ? <Card style={styles.panel}>
          <Text style={font.h2}>ยังไม่มีเนื้อหาในวิชานี้</Text>
          <Text style={font.caption}>{opening.greeting}</Text>
          <View style={{ gap: 8, marginTop: 12 }}>
            <Button onPress={() => router.push(subjectId ? ("/subject/" + subjectId) as any : "/(tabs)/subjects" as any)} icon="cloud-upload-outline">อัปโหลดไฟล์เนื้อหา</Button>
            <Pressable style={styles.ghostBtn} onPress={() => Linking.openURL("/classroom")}><Text style={styles.ghostText}>หรือซิงก์จาก Google Classroom</Text></Pressable>
          </View>
        </Card> : null}

        {openBusy ? <View style={styles.thinking}><ActivityIndicator color={colors.accent} /><Text style={font.caption}>อาจารย์ AI กำลังอ่านเนื้อหาในวิชา...</Text></View> : null}

        {/* ไม่มีวิชาเลย — บอกให้ชัดว่าต้องทำอะไรต่อ ไม่ใช่ค้างเงียบๆ */}
        {!openBusy && !subjects.length ? <Card style={styles.panel}>
          <Text style={font.h2}>ยังไม่มีวิชาในบัญชีนี้</Text>
          <Text style={font.caption}>
            เพิ่มวิชาเองได้เลย (ตั้งชื่อ + รหัสวิชา) แล้วอัปโหลดสไลด์/PDF/โน้ตเข้าไป
            หรือจะซิงก์จาก Google Classroom ก็ได้
          </Text>
          <View style={{ gap: 8, marginTop: 12 }}>
            <Button onPress={() => router.push("/(tabs)/subjects" as any)} icon="add">เพิ่มวิชา</Button>
            <Pressable style={styles.ghostBtn} onPress={() => getSubjects().then(setSubjects).catch(() => Alert.alert("ยังลองไม่ได้", "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองใหม่อีกครั้ง"))}>
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
                      <Text style={styles.srcName} numberOfLines={1}>[{j + 1}] {s.title}</Text>
                      <Text style={styles.srcMeta} numberOfLines={1}>{s.sourceLabel || ""}{s.chunk ? " · ตอนที่ " + s.chunk : ""}{s.updatedAt ? " · " + new Date(s.updatedAt).toLocaleDateString("th-TH") : ""}</Text>
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
              {m.casual ? null : m.grounded === false
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
                {s.minutes ? <Text style={[font.caption, { color: "#38bdf8" }]}>≈ {s.minutes} นาที</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
            </Pressable>)}
          </View>
          {myPlan.skipped?.length ? <Text style={[font.caption, { marginTop: 10 }]}>ข้ามไป: {myPlan.skipped.join(" · ")}</Text> : null}
          <View style={{ gap: 8, marginTop: 14 }}>
            <Pressable style={styles.ghostBtn} onPress={resetOnboarding}><Text style={styles.ghostText}>ปรับแผนใหม่</Text></Pressable>
          </View>
        </Card> : null}

        <Card style={styles.panel}>
          <Text style={font.h2}>แผนการเรียนทั้งวิชา</Text>
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
                <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                  <Pill text={t.level || "กลาง"} color={t.level === "พื้นฐาน" ? "#34d399" : t.level === "สูง" ? "#f43f5e" : "#38bdf8"} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
            </Pressable>)}
          </View>
        </Card> : null}
        <View style={{ height: 8 }} />
      </> : null}

      {tab === "diag" ? <>
        {/* ===== โหมดย่อย "ดึงโจทย์" — หน้าข้อสอบใหญ่เหลือแค่อันนี้ล้วน ===== */}
        {diagStage === "pull" ? <>
        {/* ===== ดึงโจทย์จริงจากในวิชา — โหมดฝึกทำรหัสเทียมซ่อนหน้านี้ทั้งหมด ===== */}
        {!practice ? <Card style={styles.panel}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="document-attach-outline" size={19} color="#4ade80" />
            <Text style={font.h2}>โจทย์จากในวิชา</Text>
            {/* ปุ่มเปิด popup เลือกแนวข้อสอบ — เดิมเด้งอัตโนมัติตอนเข้าโหมดข้อสอบ
                 ตอนนี้เข้าโหมดข้อสอบทันที แนวต่างๆ (ผังภาพ/ตารางเทียบ/สุ่มทุกอย่าง) เลือกจากปุ่มนี้แทน */}
            <Pressable style={styles.styleBtn} onPress={() => setExamPick(true)}>
              <Ionicons name="options-outline" size={14} color="#a78bfa" />
              <Text style={styles.styleBtnText}>เลือกแนว</Text>
            </Pressable>
          </View>

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
        </Card> : null}

        {/* หน้าแบบฝึกแต่ละรูปแบบ — สร้างข้อแรกทันทีเมื่อเลือกเมนู */}
        {practice && !problem ? <Card style={styles.panel}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name={(FORMATS.find((f) => f.k === pullStyle)?.icon || "school-outline") as any} size={19} color="#818cf8" />
            <Text style={font.h2}>ฝึกทำ{FORMATS.find((f) => f.k === pullStyle)?.label || "โจทย์"}</Text>
          </View>
          {/* เลือกไฟล์ต้นทาง + ระดับก่อนเริ่มฝึก — ไม่เลือก = ทั้งวิชา + เรียงง่ายก่อน */}
          <FileLevelPick
            files={fileList} busy={fileBusy}
            pickFile={pickFile} onFile={setPickFile}
            pickLevel={pickLevel} onLevel={setPickLevel}
            codeMode={pullStyle === "code" || mode === "code"}
            stepStart={1}
          />
          <Button onPress={() => loadProblem(pullStyle)} loading={probBusy} icon="play-outline">
            ลองเตรียมโจทย์อีกครั้ง
          </Button>
          <Pressable style={styles.ghostBtn} onPress={() => setExamPick(true)}><Text style={styles.ghostText}>เปลี่ยนรูปแบบ</Text></Pressable>
        </Card> : null}

        {/* ===== หน้าเลือกก่อนดึง — กด "ดึงโจทย์" แล้วขึ้นตรงนี้:
             เลือกว่าจะเอาโจทย์ "แนวไหนบ้าง" + "หัวข้อไหนบ้าง" ค่อยกดดึงจริง ===== */}
        {!practice && pickStage ? <Card style={styles.panel}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="options-outline" size={19} color="#a78bfa" />
            <Text style={font.h2}>เลือกโจทย์ที่ต้องการ</Text>
          </View>

          {/* ขั้น 1 — แนวโจทย์: เลือกได้อย่างเดียว มีผลเฉพาะรอบดึงนี้ ไม่แตะโหมดหลัก */}
          <Text style={styles.stepLabel}>1. แนวโจทย์ — เลือกได้อย่างเดียว</Text>
          <View style={styles.pickRow}>
            <Pressable style={[styles.srcChip, pullStyle === "" && styles.srcChipOn]} onPress={() => setPullStyle("")}>
              <Ionicons name="grid-outline" size={13} color={pullStyle === "" ? "#a78bfa" : colors.textMuted} />
              <Text style={[styles.srcChipText, pullStyle === "" && { color: "#a78bfa" }]}>ระบบเลือกให้เอง</Text>
            </Pressable>
            <Pressable style={[styles.srcChip, pullStyle === "options" && styles.srcChipOn]} onPress={() => setPullStyle(pullStyle === "options" ? "" : "options")}>
              <Ionicons name="list-outline" size={13} color={pullStyle === "options" ? "#fbbf24" : colors.textMuted} />
              <Text style={[styles.srcChipText, pullStyle === "options" && { color: "#fbbf24" }]}>ตัวเลือก ก ข ค ง</Text>
            </Pressable>
            {hasCodeMode ? <Pressable style={[styles.srcChip, pullStyle === "code" && styles.srcChipOn]} onPress={() => setPullStyle(pullStyle === "code" ? "" : "code")}>
              <Ionicons name="code-slash-outline" size={13} color={pullStyle === "code" ? "#34d399" : colors.textMuted} />
              <Text style={[styles.srcChipText, pullStyle === "code" && { color: "#34d399" }]}>โค้ด</Text>
            </Pressable> : null}
          </View>

          {/* ขั้น 2 — หัวข้อ: อ่านจากไฟล์ที่ซิงก์มา เลือกได้หลายอัน (ไม่เลือก = ทั้งวิชา) */}
          <Text style={styles.stepLabel}>2. หัวข้อ — เลือกได้หลายอัน</Text>
          {sylBusy ? <Text style={font.caption}>กำลังโหลดหัวข้อ...</Text> : null}
          {(syllabus?.topics || []).length ? <>
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
          </> : !sylBusy ? <Text style={font.caption}>ยังไม่มีหัวข้อให้เลือก — ดึงจากทั้งวิชาแทน</Text> : null}

          {/* ขั้น 3–4 — ไฟล์ต้นทาง (1 ไฟล์) + ระดับความยาก: ใช้กับทุกแนวข้อสอบ
              มีผลเฉพาะ "โจทย์มาจาก = ไฟล์ในวิชา" เท่านั้น (งานที่ส่งไม่มีไฟล์ให้เลือก) */}
          {src === "class" ? <FileLevelPick
            files={fileList} busy={fileBusy}
            pickFile={pickFile} onFile={setPickFile}
            pickLevel={pickLevel} onLevel={setPickLevel}
            codeMode={pullStyle === "code" || mode === "code"}
            stepStart={3}
          /> : null}

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
          {probHint ? <Text style={[font.caption, { marginTop: 6, color: "#c4b5fd" }]}>{probHint}</Text> : null}
          <View style={{ marginTop: 12 }}>
            <Button onPress={() => setPickerOpen(true)} variant="secondary" icon="swap-horizontal-outline">เปลี่ยนวิชา</Button>
            {practice ? null : <Button onPress={() => setPickStage(true)} variant="ghost" icon="folder-open-outline">เลือกไฟล์ / ระดับความยาก</Button>}
          </View>
        </Card> : null}

        {problem ? <Card style={styles.panel}>
          {/* โหมดฝึก — เปลี่ยนไฟล์/ระดับได้ระหว่างทำ (ไม่เกี่ยวกับเฉลย ไม่ปลดล็อกอะไร) */}
          <FileLevelPick
            files={fileList} busy={fileBusy}
            pickFile={pickFile} onFile={setPickFile}
            pickLevel={pickLevel} onLevel={setPickLevel}
            codeMode={fmt === "code"}
            stepStart={1}
          />
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
            <Text style={styles.probCount}>{problem.totalProblems} โจทย์{pickFile ? "ในไฟล์นี้" : "ในวิชานี้"}</Text>
          </View>

          {practice ? <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <Text style={[font.caption, { flex: 1 }]}>แบบฝึก{fmtMeta.label} · วิชานี้</Text>
            <Pressable style={styles.ghostBtn} onPress={() => setExamPick(true)}><Text style={styles.ghostText}>เปลี่ยนรูปแบบ</Text></Pressable>
          </View> : null}

          {/* ไม่เจอข้อระดับที่เลือกในไฟล์นี้ — AI ต่อยอดข้อนี้ให้ตรงระดับแทน (แจ้งเบา ๆ ไม่ขวางการทำ) */}
          {problem.levelFallback ? <Text style={styles.levelNote}>{fmt === "code" ? "ไม่มีโจทย์โค้ดในระดับนี้พอดี — เลือกโจทย์จากไฟล์ที่ใกล้ระดับที่สุด โดยคงเนื้อหาตามไฟล์เรียน" : "ไม่เจอข้อระดับนี้ในไฟล์ — ปรับโจทย์ตามระดับที่เลือก"}</Text> : null}


          {/* โจทย์ — แสดงผ่าน RichText เพื่อให้มีสี/กล่องเหมือนโค้ดและผังภาพ */}
          <View style={styles.probBox}><RichText text={problem.problem} tone="dark" /></View>

          {/* วิเคราะห์โจทย์ — แยกจากตัวโจทย์ (โจทย์ไม่มีส่วนวิเคราะห์ปน)
              ผู้เรียนกดดูเองตอนอยากเห็นแนวทาง Input/Output/Process/รหัสเทียม
              โหมดฝึกทำรหัสเทียมซ่อนไว้ทั้งหมด — ผลวิเคราะห์มีส่วน "รหัสเทียม" ที่เป็นเฉลยข้อนั้น */}
          {!practice ? <>
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
          ) : null}</>
          : null}

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
              </View> : null}
            </View>
            : fmt === "pseudocode" ? <View>
              {/* รหัสเทียม — ช่องเขียนมีเลขบรรทัด เหมาะกับการเรียงขั้นตอน (เฉลยไม่มีในแนวนี้) */}
              <CodeInput value={myAnswer} onChange={setMyAnswer} placeholder="พิมพ์รหัสเทียมของคุณทีละบรรทัด..." />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Pressable style={styles.ghostBtn} onPress={() => setMyAnswer("")}><Text style={styles.ghostText}>ล้าง</Text></Pressable>
                {/* โหมดฝึกทำ — ขอคำใบ้ AI: ใบ้ทีละขั้น ไม่บอกเฉลย ไม่แทรกอะไรลงช่องคำตอบ */}
                {pseudoPractice ? <Pressable style={[styles.ghostBtn, psuHintBusy && { opacity: 0.5 }]} disabled={psuHintBusy}
                  onPress={fetchPracticeHint}>
                  <Text style={styles.ghostText}>
                    {psuHintBusy ? "กำลังคิดคำใบ้..." : practiceHints.length ? "ขอคำใบ้เพิ่ม" : "ติด? ขอคำใบ้"}
                  </Text>
                </Pressable> : null}
              </View>

              {/* คำใบ้ที่ได้มาทั้งหมด — เรียงตามลำดับที่ขอ (ข้อถัดไปใบ้ลึกขึ้น) */}
              {practiceHints.length ? <View style={styles.hintBox}>
                <View style={styles.hintHead}>
                  <Ionicons name="bulb-outline" size={14} color="#fbbf24" />
                  <Text style={styles.hintHeadText}>คำใบ้ {practiceHints.length} ข้อ — ยังไม่ใช่เฉลย ทำต่อเองได้เลย</Text>
                </View>
                {practiceHints.map((h, i) => (
                  <Text key={i} style={[font.caption, { color: "#fde68a", marginTop: 6, lineHeight: 20 }]}>
                    {i + 1}. {h}
                  </Text>
                ))}
              </View> : null}
            </View>
            : fmt === "flowchart" || fmt === "diagram" ? <FlowchartBuilder
              key={`${subjectId}:${problem.source?.materialId || ""}:${problem.problem}`}
              question={problem.problem}
              feedback={mark ? typeof mark === "string" ? mark : typeof mark.feedback === "string" ? mark.feedback : mark.feedback?.fix || (mark.correct === true ? "ตรวจแล้ว: ถูกต้อง" : mark.correct === false ? "ตรวจแล้ว: ลองแก้ผังงานอีกครั้ง" : "") : ""}
              busy={markBusy || probBusy}
              onChange={setMyAnswer}
              onCheck={checkMyAnswer}
              onNext={() => loadProblem(pullStyle)}
              onBack={() => { setFocusedPractice(false); setExamPick(true); }}
            />
            : fmt === "table" ? <View style={{ marginTop: 12, gap: 8 }}>
              <Text style={font.caption}>กรอกคำตอบเป็นตาราง Markdown แล้วดูตัวอย่างได้ทันที</Text>
              <TextInput
                value={myAnswer} onChangeText={setMyAnswer} multiline
                placeholder={'| หัวข้อ | รายละเอียด |\n| --- | --- |\n| ... | ... |'}
                placeholderTextColor={colors.textMuted} style={styles.ansInput}
              />
              {myAnswer.trim() ? <RichText text={myAnswer} tone="dark" /> : null}
            </View>
            : <TextInput
              value={myAnswer} onChangeText={setMyAnswer} multiline
              placeholder="พิมพ์คำตอบของคุณ..."
              placeholderTextColor={colors.textMuted} style={styles.ansInput}
            />}
          </View>

          <View style={{ gap: 8, marginTop: 14 }}>
            <Button onPress={checkMyAnswer} loading={markBusy} icon="checkmark-done-outline">ตรวจคำตอบ</Button>
            {/* โหมดฝึกทำรหัสเทียม — ตรวจ "ถูก" แล้วค่อยไปข้อถัดไป (สุ่มข้อใหม่จากไฟล์ ไม่ซ้ำเดิม)
                 ส่วนโจทย์ซ้อน/ถาม AI ถูกซ่อนตามที่ผู้ใช้สั่งให้หน้านี้มีแค่การฝึกล้วน */}
            {practice && typeof mark === "object" && mark?.correct === true
              ? <Button onPress={() => loadProblem(pullStyle)} loading={probBusy} icon="arrow-forward-outline">โจทย์ถัดไป · {fmtMeta.label}</Button>
              : null}
            {practice && !pseudoPractice ? <Button onPress={() => loadProblem(pullStyle)} loading={probBusy} variant="secondary" icon="shuffle-outline">ข้ามไปโจทย์ถัดไป</Button> : null}
            {/* ตอบผิด = ทำอีกครั้ง: ปิดผลตรวจเพื่อกลับไปแก้คำตอบเดิมในช่อง (คำตอบไม่ถูล้าง) แล้วส่งตรวจใหม่ */}
            {practice && typeof mark === "object" && mark?.correct === false
              ? <Button onPress={() => { setMark(null); setMissing([]); }} variant="secondary" icon="refresh-outline">ทำอีกครั้ง</Button>
              : null}
            {!practice ? <>
              <Button onPress={loadVariant} loading={probBusy} variant="secondary" icon="repeat-outline">ขอโจทย์ซ้อน</Button>
              <Button onPress={() => { loadProblem(); setTab("chat"); }} variant="secondary" icon="chatbubbles-outline">ถามอาจารย์ AI ช่วย</Button>
            </> : null}
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
                  {mark.lines?.length ? (
                    <View style={{ marginTop: 8 }}>
                      <Text style={styles.markTitle}>บรรทัดที่ต้องแก้</Text>
                      {mark.lines.map((l: any, i: number) => (
                        <Text key={i} style={[font.caption, { lineHeight: 20 }]}>
                          • บรรทัด {l.line}: {l.why || "-"}{l.fix ? ` → ${l.fix}` : ""}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {mark.fix ? <RichText text={"**ต้องแก้:** " + mark.fix} /> : null}
                </>
              ) : <RichText text={mark} />}
            </View>
          </View> : null}
        </Card> : null}
        </> : null}

        {/* ===== โหมดย่อย "วินิจฉัยอัตโนมัติ" — เลือกจาก popupตอนเข้าแท็บข้อสอบ ===== */}
        {diagStage === "quiz" ? <>
        <Pressable style={styles.ghostBtn} onPress={() => setDiagStage("pull")}>
          <Text style={styles.ghostText}>← กลับไปดึงโจทย์</Text>
        </Pressable>

        <Card style={styles.panel}>
          <Text style={font.h2}>วินิจฉัยอัตโนมัติ</Text>

          <Text style={[styles.segLabel, { marginTop: 14 }]}>รูปแบบข้อสอบ</Text>
          <View style={{ gap: 8, marginTop: 8 }}>
            <Pressable onPress={() => setQuizSourceMode("source")}
              style={[styles.optRow, quizSourceMode === "source" && { borderColor: colors.accent, backgroundColor: colors.accent + "18" }]}>
              <View style={{ flex: 1 }}>
                <Text style={font.title}>ยึดแบบฝึกหัดและเนื้อหาในไฟล์</Text>
                <Text style={font.caption}>ถ้าพบโจทย์จริงจะใช้เป็นหลัก ถ้าไม่พบจะสร้างจากบทเรียนที่เลือก</Text>
              </View>
              {quizSourceMode === "source" ? <Ionicons name="checkmark-circle" size={20} color={colors.accent} /> : null}
            </Pressable>
            <Pressable onPress={() => setQuizSourceMode("new")}
              style={[styles.optRow, quizSourceMode === "new" && { borderColor: "#38bdf8", backgroundColor: "#38bdf818" }]}>
              <View style={{ flex: 1 }}>
                <Text style={font.title}>สร้างโจทย์ใหม่จากบทเรียน</Text>
                <Text style={font.caption}>สร้างคำถามใหม่ที่ไม่คัดลอกแบบฝึกหัดเดิม และยึดข้อมูลในไฟล์เท่านั้น</Text>
              </View>
              {quizSourceMode === "new" ? <Ionicons name="checkmark-circle" size={20} color="#38bdf8" /> : null}
            </Pressable>
          </View>

          <Text style={[styles.segLabel, { marginTop: 14 }]}>ไฟล์ต้นทาง</Text>
          {fileBusy ? <Text style={font.caption}>กำลังโหลดรายชื่อไฟล์...</Text> : <View style={styles.srcRow}>
            <Pressable style={[styles.srcChip, !quizMaterialId && styles.srcChipOn]} onPress={() => setQuizMaterialId("")}>
              <Text style={[styles.srcChipText, !quizMaterialId && { color: colors.accent }]}>ทุกไฟล์ในวิชา</Text>
            </Pressable>
            {fileList.map((file: any) => {
              const on = quizMaterialId === file.id;
              return <Pressable key={file.id} style={[styles.srcChip, on && styles.srcChipOn]}
                onPress={() => setQuizMaterialId(on ? "" : file.id)}>
                <Text numberOfLines={2} style={[styles.srcChipText, on && { color: colors.accent }]}>{file.title}</Text>
              </Pressable>;
            })}
          </View>}

          <Text style={[styles.segLabel, { marginTop: 14 }]}>หัวข้อที่จะสอบ</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
            <Pressable style={[styles.chip, !focusTopics.length && styles.chipOn]} onPress={() => setFocusTopics([])}>
              <Text style={[styles.chipText, !focusTopics.length && { color: "#fff" }]}>ทุกหัวข้อ</Text>
            </Pressable>
            {(syllabus?.topics || []).slice(0, 24).map((topic: any) => {
              const on = focusTopics.includes(topic.label);
              return <Pressable key={topic.k + topic.label} style={[styles.chip, on && styles.chipOn]} onPress={() => {
                setFocusTopics((current) => on
                  ? current.filter((item) => item !== topic.label)
                  : current.length < 6 ? [...current, topic.label] : current);
              }}>
                <Text style={[styles.chipText, on && { color: "#fff" }]}>{topic.label}</Text>
              </Pressable>;
            })}
          </View>
          {sylBusy ? <Text style={[font.caption, { marginTop: 6 }]}>กำลังโหลดหัวข้อจากเนื้อหา...</Text> : null}
          {!sylBusy && !(syllabus?.topics || []).length ? <Text style={[font.caption, { marginTop: 6 }]}>ไม่มีหัวข้อย่อยที่สกัดได้ ระบบจะใช้เนื้อหาในไฟล์ทั้งหมด</Text> : null}

          <Button onPress={() => startQuizFocused()} loading={quizBusy} icon="checkmark-circle-outline">
            เริ่มข้อสอบ ({quizMaterialId ? "ไฟล์ที่เลือก" : "ทั้งวิชา"} · {focusTopics.length ? focusTopics.length + " หัวข้อ" : "ทุกหัวข้อ"})
          </Button>
        </Card>

        {quiz && !result ? <View style={{ gap: 10 }}>
          <View style={styles.progressWrap}>
            <Text style={font.caption}>ตอบแล้ว {quiz.questions.filter((question: any, index: number) => question.type === "SHORT_ANSWER" ? !!photoAnswers[index] : picks[index] >= 0).length}/{quiz.questions.length} ข้อ</Text>
            <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${(quiz.questions.filter((question: any, index: number) => question.type === "SHORT_ANSWER" ? !!photoAnswers[index] : picks[index] >= 0).length / quiz.questions.length) * 100}%` }]} /></View>
            {quiz.focused?.length ? <Text style={font.caption}>เน้น: {quiz.focused.join(" · ")}</Text> : null}
          </View>
          {quiz.generatedByAi === false ? <Text style={[font.caption, { color: "#f59e0b" }]}>{quiz.generationNotice || "AI ไม่พร้อมใช้งานชั่วคราว ข้อสอบนี้ยึดข้อความจริงในไฟล์"}</Text> : null}
          {quiz.questions.map((qq: any, qi: number) => {
            const photo = photoAnswers[qi];
            return <Card key={qi} style={styles.qCard}>
            <Text style={styles.qNum}>ข้อที่ {qi + 1}{qq.topic ? ` · ${qq.topic}` : ""}</Text>
            <Text style={font.title}>{qq.question}</Text>
            {qq.type === "SHORT_ANSWER" ? <View style={{ gap: 9, marginTop: 10 }}>
              <Text style={font.caption}>เขียนวิธีทำหรือคำตอบลงสมุด แล้วถ่ายภาพให้เห็นข้อความชัดเจนทั้งหน้า</Text>
              {photo ? <View style={{ gap: 6 }}>
                <Image source={{ uri: photo.uri }} resizeMode="contain" style={{ width: "100%", height: 220, borderRadius: 12, backgroundColor: colors.surfaceAlt }} />
                <Text style={font.caption}>{photo.fileName || "แนบภาพแล้ว"} · ระบบจะส่งภาพให้ AI ตรวจ และไม่เก็บเป็นไฟล์ถาวร</Text>
              </View> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Pressable style={[styles.opt, { flexGrow: 1, justifyContent: "center" }]} onPress={() => captureWrittenAnswer(qi)}>
                  <Ionicons name="camera-outline" size={18} color={colors.accent} /><Text style={styles.optText}>{photo ? "ถ่ายใหม่" : "ถ่ายรูปวิธีทำ"}</Text>
                </Pressable>
                <Pressable style={[styles.opt, { flexGrow: 1, justifyContent: "center" }]} onPress={() => chooseWrittenAnswerPhoto(qi)}>
                  <Ionicons name="images-outline" size={18} color={colors.accent} /><Text style={styles.optText}>{photo ? "เปลี่ยนรูป" : "เลือกรูปจากเครื่อง"}</Text>
                </Pressable>
                {photo ? <Pressable style={[styles.opt, { justifyContent: "center" }]} onPress={() => setPhotoAnswers((current) => { const next = { ...current }; delete next[qi]; return next; })}>
                  <Ionicons name="trash-outline" size={18} color="#f43f5e" /><Text style={styles.optText}>ลบรูป</Text>
                </Pressable> : null}
              </View>
            </View> : uniqueOptions<string>(qq.options || []).map((o: string, oi: number) => {
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
          </Card>;
          })}
          <Button onPress={submitQuiz} loading={quizBusy} icon="checkmark">ส่งคำตอบ</Button>
        </View> : null}

        {result ? <Card style={styles.panel}>
          <View style={{ alignItems: "center", marginBottom: 12 }}>
            <Text style={[styles.score, { color: result.score >= 70 ? "#34d399" : result.score >= 40 ? "#f59e0b" : "#f43f5e" }]}>{result.score}</Text>
            <Text style={font.caption}>คะแนน ({result.correct}/{result.total})</Text>
          </View>
          <Text style={styles.recTitle}>{result.generatedByAi ? "คำแนะนำจากอาจารย์ AI" : "คำแนะนำจากผลคะแนน"}</Text>
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
            {(result.results || []).map((r: any, i: number) => <View key={i} style={[styles.reviewRow, r.score >= 70 ? styles.reviewOk : styles.reviewBad]}>
              <Ionicons name={r.score >= 70 ? "checkmark-circle" : "close-circle"} size={17} color={r.score >= 70 ? "#34d399" : "#f43f5e"} />
              <View style={{ flex: 1 }}>
                <Text style={font.title}>{i + 1}. {r.question}</Text>
                {r.type === "SHORT_ANSWER" ? <>
                  <Text style={{ marginTop: 4, fontSize: 12, fontWeight: "700", color: r.score >= 70 ? "#34d399" : "#f43f5e" }}>วิธีทำได้ {r.score}/100</Text>
                  <Text style={[font.caption, { marginTop: 4 }]}>อ่านข้อความจากภาพ: {r.transcription || "อ่านไม่พบข้อความ"}</Text>
                  <Text style={[font.caption, { color: "#34d399" }]}>แนวคำตอบ: {r.answer || "—"}</Text>
                  {r.feedback ? <Text style={[font.caption, { color: r.score >= 70 ? "#34d399" : "#f43f5e" }]}>ข้อเสนอแนะ: {r.feedback}</Text> : null}
                </> : <>
                  <Text style={{ marginTop: 4, fontSize: 12, fontWeight: "700", color: r.correct ? "#34d399" : "#f43f5e" }}>
                    {r.correct ? "ตอบถูก ✓" : "ตอบผิด ✗"}
                  </Text>
                  <Text style={[font.caption, { color: "#34d399" }]}>เฉลย: {r.answer || "—"}</Text>
                  <Text style={[font.caption, { color: r.correct ? "#34d399" : "#f43f5e" }]}>คำตอบของคุณ: {r.chosen || "ไม่ได้ตอบข้อนี้"}</Text>
                </>}
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
        </> : null}
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
          {/* ไปยังหน้าต่างๆ — กดอันเดียว = เข้าโหมดนั้นทันที
               ข้อสอบ: เข้าหน้าข้อสอบแล้วเด้ง popup เลือกแนวให้เลือกทันที
               บนหน้าถาม–ตอบ: ไม่ทำเครื่องหมายส่วนนี้ เพราะเลือกแทนด้วย "โหมด" ด้านล่าง (รวมเป็นการเลือกเดียว) */}
          <Text style={styles.popHead}>ไปที่</Text>
          <View style={styles.popCol}>
            {TABS.map((t) => {
              const on = tab === t.k && tab !== "chat";
              return <Pressable key={t.k} onPress={() => { setTab(t.k); setOptOpen(false); if (t.k === "diag") { setFocusedPractice(false); setPullStyle(""); setDiagStage("pull"); setExamPick(true); } }}
                style={[styles.popItem, on && { borderColor: colors.accent, backgroundColor: colors.accent + "26" }]}>
                <Ionicons name={t.icon as any} size={15} color={on ? colors.accent : colors.textSecondary} />
                <Text style={[styles.popItemText, on && { color: "#fff" }]}>{t.label}</Text>
                {on ? <Ionicons name="checkmark" size={15} color={colors.accent} /> : <View style={{ flex: 1 }} />}
              </Pressable>;
            })}
          </View>

          <View style={styles.popDivider} />

          {/* โหมด — เลือกได้อันเดียว และกดแล้วเข้าโหมดนั้นทันที (กลับหน้าถาม–ตอบเพื่อให้เห็นผล)
               แสดงเครื่องหมายเฉพาะตอนอยู่หน้าถาม–ตอบ เพื่อไม่ให้ค้างทับกับ "ไปที่" */}
          <Text style={styles.popHead}>โหมด</Text>
          <View style={styles.popCol}>
            {(subjectModes.length ? subjectModes : FALLBACK_MODES).map((m) => {
              const on = mode === m.k && tab === "chat";
              return <Pressable key={m.k} onPress={() => {
                const next = m.k as Mode;
                const toCode = next === "code" && mode !== "code";
                setMode(next); setOptOpen(false);
                // โหมดโค้ด = ไปหน้าโจทย์แล้วดึงโจทย์เขียน/อ่านโค้ดให้ทันที
                if (toCode) { setTab("diag"); setDiagStage("pull"); if (!probBusy) loadProblem("code"); }
                // โหมดอื่น = กลับหน้าถาม–ตอบทันที กดอะไรก็เห็นโหมดนั้น ไม่ค้างทับโหมดอื่น
                else setTab("chat");
              }}
                style={[styles.popItem, on && { borderColor: m.color, backgroundColor: m.color + "26" }]}>
                <Ionicons name={m.icon as any} size={15} color={on ? m.color : colors.textSecondary} />
                <Text style={[styles.popItemText, on && { color: "#fff" }]}>{m.label}</Text>
                <View style={{ flex: 1 }} />
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
                <View style={{ flex: 1 }} />
                {on ? <Ionicons name="checkmark" size={15} color="#38bdf8" /> : null}
              </Pressable>;
            })}
          </View>

          <View style={styles.popDivider} />

          {/* ระดับความยาก */}
          <Text style={styles.popHead}>ความยากของโจทย์</Text>
          <View style={styles.popCol}>
            {LEVELS.map((l) => {
              const on = level === l.k;
              return <Pressable key={l.k} onPress={() => { setLevel(l.k); setOptOpen(false); }}
                style={[styles.popItem, on && { borderColor: l.color, backgroundColor: l.color + "26" }]}>
                <Text style={[styles.popItemText, on && { color: "#fff" }]}>{l.label}</Text>
                <View style={{ flex: 1 }} />
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

      {/* popup เลือกว่าจะเข้าทำอะไรในโหมดข้อสอบ — เด้งตอนเข้าแท็บ "ข้อสอบ" */}
      {/* animationType="none" — เดิมใช้ "fade" แต่แอนิเมชันของ RNW พึ่ง requestAnimationFrame
           ซึ่งถูก suspend ในสภาพแวดล้อมที่ไม่ render ต่อเนื่อง ทำให้ fade-out ไม่จบ
           และ popup ค้างบังหน้าจอ — ปิดทันทีจึงเชื่อถือได้กว่า */}
      <Modal visible={examPick} animationType="none" transparent onRequestClose={() => setExamPick(false)}>
        <Pressable style={styles.backdrop} onPress={() => setExamPick(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{subject ? `ทำข้อสอบ — ${subject.name}` : "จะเลือกทำอะไร?"}</Text>
            <Pressable onPress={() => setExamPick(false)}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>
          </View>

          {/* ทุกแนวเปิดเป็นหน้าแบบฝึกทันที และใช้เนื้อหาของวิชาที่เลือก */}
          <ScrollView style={{ maxHeight: 470 }} showsVerticalScrollIndicator={false}>
            {(subjectFormats || [
              { k: "options", label: "ตัวเลือกแบบช้อยส์", hint: "โจทย์พร้อมตัวเลือก 4 ข้อ และเฉลยทันที", icon: "list-outline", color: "#fbbf24" },
              { k: "random", label: "สุ่มทุกอย่าง", hint: "สุ่มเฉพาะรูปแบบที่เหมาะกับวิชานี้", icon: "shuffle-outline", color: "#fb923c" },
              { k: "", label: "ดึงโจทย์จากเนื้อหา", hint: "ให้ระบบเลือกรูปแบบที่ตรงกับหัวข้ออัตโนมัติ", icon: "document-text-outline", color: "#4ade80" },
              { k: "quiz", label: "วินิจฉัยอัตโนมัติ", hint: "ทำข้อสอบสั้นและดูหัวข้อที่ควรเน้น", icon: "checkmark-done-outline", color: "#a78bfa" },
            ] as { k: string; label: string; hint: string; icon: string; color: string }[]).map((s) => {
              const isQuiz = s.k === "quiz";
              // แถว quiz ไฮไลต์เมื่ออยู่หน้าวินิจฉัย / แถวแนวอื่นไฮไลต์เมื่ออยู่หน้าดึงและแนวตรงกับที่เลือกไว้
              const on = isQuiz ? diagStage === "quiz" : diagStage === "pull" && pullStyle === s.k;
              return <Pressable key={s.k || "system"} onPress={() => {
                  setExamPick(false);
                  if (isQuiz) {
                    setFocusedPractice(false);
                    setPullStyle("");
                    setTab("diag");
                    setDiagStage("quiz");
                    setQuiz(null); setResult(null); setPicks([]);
                    return;
                  }
                  // เลือกแนวแล้วเปิดหน้าแบบฝึกทันที พร้อมดึงโจทย์ให้ตรงกับฟอร์แมต
                  setDiagStage("pull");
                  setTab("diag");
                  setPullStyle(s.k);
                  setFocusedPractice(true);
                  setPickStage(false);
                  setProblem(null); setMark(null); setMyAnswer(""); setPicked(-1);
                  void loadProblem(s.k);
                }}
                style={[styles.row, on && { backgroundColor: s.color + "26", borderWidth: 1, borderColor: s.color }]}>
                <View style={[styles.wantIcon, { backgroundColor: s.color + "22", marginBottom: 0 }]}>
                  <Ionicons name={s.icon as any} size={19} color={s.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, on && { color: "#fff" }]}>{s.label}</Text>
                </View>
                {on ? <Ionicons name="checkmark-circle" size={20} color={s.color} /> : <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />}
              </Pressable>;
            })}
          </ScrollView>

          <Pressable style={styles.ghostBtn} onPress={() => setExamPick(false)}>
            <Text style={styles.ghostText}>ไว้ทีหลัง</Text>
          </Pressable>
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
          {pickGroups.map((g, gi) => <View key={"pg" + gi}>
            {g.label ? <Text style={styles.pickGroup}>{g.label}</Text> : null}
            {g.list.map((s: any) => {
              const on = s.id === subjectId;
              return <Pressable key={s.id} style={[styles.row, on && styles.rowOn]}
                onPress={() => { setSubjectId(s.id); resetOnboarding(); setFocusTopics([]); setPlan(null); setPickerOpen(false); setPickStage(false); setPullStyle(""); setFocusedPractice(false); setProblem(null); }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, on && { color: "#fff" }]} numberOfLines={2}>{s.name}</Text>
                  <Text style={[styles.rowMeta, on && { color: "#ede9fe" }]}>{s._count?.materials || 0} ไฟล์</Text>
                </View>
                {on ? <Ionicons name="checkmark-circle" size={20} color="#fff" /> : null}
              </Pressable>;
            })}
          </View>)}
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

function levelColor(level: string) {
  return level === "easy" ? "#34d399" : level === "hard" ? "#f43f5e" : "#fbbf24";
}

/**
 * หน้าเลือก "ไฟล์ต้นทาง + ระดับความยาก" — ใช้ร่วมกันทุกแนวข้อสอบ
 * (หน้าดึงโจทย์ + การ์ดเริ่มฝึก + หน้าโจทย์ระหว่างฝึก)
 * ระดับอิงลำดับไฟล์ใน Classroom: ไฟล์ต้น (บทแรก/สัปดาห์แรก) = ง่าย ไฟล์ท้าย = ยาก
 * ไม่เลือกไฟล์ = ทั้งวิชา, ไม่เลือกระดับ = ระบบเรียงง่ายก่อนให้เองเสมอ
 */
function FileLevelPick(props: {
  files: any[]; busy: boolean;
  pickFile: string; onFile: (id: string) => void;
  pickLevel: "" | "easy" | "medium" | "hard"; onLevel: (l: "" | "easy" | "medium" | "hard") => void;
  codeMode?: boolean;
  /** เลขขั้นแรก — หน้าดึงโจทย์เริ่มจาก 3 (มีแนว + หัวข้อนำอยู่), หน้าฝึกเริ่มจาก 1 */
  stepStart?: number;
  /** กระชับ = ใช้ในหน้าโจทย์ระหว่างฝึก (รายการไฟล์สั้นลง) */
}) {
  const { files, busy, pickFile, onFile, pickLevel, onLevel, codeMode = false, stepStart = 1 } = props;
  const [expanded, setExpanded] = useState(false);
  const visibleFiles = codeMode ? files.filter((file: any) => Number(file.codeCount || 0) > 0) : files;
  const selectedFile = visibleFiles.find((file: any) => file.id === pickFile);
  const levelLabel = pickLevel === "easy" ? "ง่าย" : pickLevel === "medium" ? "กลาง" : pickLevel === "hard" ? "ยาก" : "เรียงง่ายก่อน";
  const fileCountLabel = (file: any) => codeMode ? `${Number(file.codeCount || 0)} โจทย์โค้ด` : `${Number(file.count || 0)} โจทย์`;
  const fileLevelName = (file: any) => {
    const value = codeMode ? file.codeLevel : file.level;
    return value === "easy" ? "ง่าย" : value === "medium" ? "กลาง" : value === "hard" ? "ยาก" : "";
  };
  return <>
    <Pressable onPress={() => setExpanded(true)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
      <Ionicons name="options-outline" size={18} color="#7c5ce7" />
      <View style={{ flex: 1 }}><Text style={{ fontWeight: "900", color: colors.text }}>ตัวเลือกโจทย์</Text><Text numberOfLines={1} style={font.caption}>{selectedFile?.title || "ทุกไฟล์ในวิชา"} · {levelLabel}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
    <Modal visible={expanded} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setExpanded(false)}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ padding: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: colors.border }}><View><Text style={font.caption}>ตั้งค่าโจทย์ · ขั้น {stepStart}</Text><Text style={font.h2}>ไฟล์และระดับความยาก</Text></View><Pressable onPress={() => setExpanded(false)}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 18 }}>
          <View style={{ padding: 14, borderRadius: 16, backgroundColor: colors.surface, gap: 10 }}>
            <Text style={font.h2}>ไฟล์ต้นทาง</Text><Text style={font.caption}>เลือกไฟล์เดียว หรือใช้ทุกไฟล์ในวิชา</Text>
            {busy ? <Text style={font.caption}>กำลังโหลดรายชื่อไฟล์...</Text> : <View style={{ gap: 8 }}>
              <Pressable style={[styles.chip, !pickFile && styles.chipOn]} onPress={() => onFile("")}><Text style={[styles.chipText, !pickFile && { color: "#fff" }]}>ทุกไฟล์ในวิชา</Text></Pressable>
              {visibleFiles.length ? visibleFiles.map((f: any) => { const on = pickFile === f.id; const difficulty = fileLevelName(f); return <Pressable key={f.id} style={[styles.chip, on && styles.chipOn]} onPress={() => onFile(on ? "" : f.id)}><Text numberOfLines={2} style={[styles.chipText, on && { color: "#fff" }]}>{f.title} · {fileCountLabel(f)}{difficulty ? ` · ${difficulty}` : ""}</Text></Pressable>; }) : <Text style={font.caption}>ยังไม่มีไฟล์ที่มีโจทย์โค้ดชัดเจนในวิชานี้</Text>}
            </View>}
          </View>
          <View style={{ padding: 14, borderRadius: 16, backgroundColor: colors.surface, gap: 10 }}><Text style={font.h2}>ระดับความยาก</Text><Text style={font.caption}>ไม่เลือก = เรียงง่ายก่อน</Text><View style={styles.pickRow}>
      {([["easy", "ง่าย"], ["medium", "กลาง"], ["hard", "ยาก"]] as const).map(([k, label]) => {
        const on = pickLevel === k;
        const lc = levelColor(k);
        return <Pressable key={k} style={[styles.srcChip, on && { borderColor: lc, backgroundColor: lc + "26" }]}
          onPress={() => onLevel(on ? "" : k)}>
          <Text style={[styles.srcChipText, on && { color: lc }]}>{label}</Text>
        </Pressable>;
      })}
          </View></View>
        </ScrollView>
        <Pressable onPress={() => setExpanded(false)} style={{ margin: 16, padding: 14, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center" }}><Text style={{ color: "white", fontWeight: "900" }}>เสร็จสิ้น</Text></Pressable>
      </View>
    </Modal>
  </>;
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
  srcRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  stepLabel: { fontSize: 13, fontWeight: "900", color: colors.text, marginTop: 16, marginBottom: 7 },
  pickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pickGroup: { fontSize: 11, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.6, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  styleBtn: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  styleBtnText: { fontSize: 11, fontWeight: "800", color: colors.textSecondary },
  srcChip: { maxWidth: 250, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  srcChipOn: { backgroundColor: "#38bdf81f", borderColor: "#38bdf8" },
  srcChipText: { maxWidth: 220, fontSize: 11, fontWeight: "800", color: colors.textSecondary },
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
  sylGroup: { fontSize: 10.5, fontWeight: "900", color: colors.textMuted, letterSpacing: 0.6 },
  chipOn: { backgroundColor: "#38bdf8", borderColor: "#38bdf8" },
  chipText: { fontSize: 11, fontWeight: "800", color: colors.textSecondary },
  // จำนวนโจทย์ในไฟล์ (ต่อท้ายชื่อไฟล์ในหน้าเลือกไฟล์ต้นทาง)
  chipCount: { fontSize: 10, fontWeight: "900", color: colors.textMuted },
  // แจ้งเบา ๆ ว่าไม่เจอข้อระดับที่เลือก AI ต่อยอดข้อที่มีให้ตรงระดับแทน
  levelNote: { fontSize: 11, fontWeight: "800", color: "#fbbf24", marginTop: 8 },
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
