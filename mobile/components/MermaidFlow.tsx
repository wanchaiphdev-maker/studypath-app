/**
 * วาด flowchart จาก Mermaid เป็นรูปจริง (SVG)
 *
 * ทำเองแทนการใช้ mermaid ของเว็บ เพราะแอปนี้รันทั้ง Expo Web และมือถือ
 * ตัว mermaid ต้องใช้ DOM จึงใช้ได้แค่บนเว็บ
 *
 * รองรับเฉพาะชุดย่อยที่โจทย์ของเราสั่งให้ AI เขียน:
 *   flowchart TD / graph TD
 *   A[ข้อความ]   กล่อง
 *   B(ข้อความ)   กล่องมน
 *   C{คำถาม}     สี่เหลี่ยมตัดสิน
 *   D([จบ])      ปลายทาง
 *   -->  และ  -->|ใช่|  ป้ายกำกับบนเส้น
 */
import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path, Rect, Polygon, G, Text as SvgText, Defs, Marker, Circle } from "react-native-svg";
import { colors } from "../lib/theme";

type Shape = "rect" | "round" | "stadium" | "diamond" | "io";
type MNode = { id: string; label: string; shape: Shape };
type MEdge = { from: string; to: string; label?: string };

const FS = 13;            // ขนาดตัวอักษร
const LH = 18;            // ความสูงบรรทัด
const PAD_X = 14;
const PAD_Y = 10;
const GAP_X = 30;
const GAP_Y = 64;
const MIN_W = 96;
const MIN_SCALE = 0.62;

/** ความกว้างโดยประมาณ — ตัวไทยกว้างกว่าอังกฤษเล็กน้อย */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) || 0;
    if (c >= 0x0e00 && c <= 0x0e7f) w += FS * 0.58;   // ไทย
    else if (c >= 0x3000) w += FS * 0.95;             // จีน/ญี่ปุ่น
    else if (ch === " ") w += FS * 0.3;
    else w += FS * 0.55;                               // อังกฤษ/ตัวเลข
  }
  return w;
}

function cleanLabel(raw: string): string {
  return String(raw || "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

const OPENERS: [string, string, Shape][] = [
  ["([", "])", "stadium"],
  ["[/", "/]", "io"],           // พาราแลลเลล้รัม input/output
  ["[[", "]]", "rect"],
  ["{{", "}}", "diamond"],
  ["[", "]", "rect"],
  ["(", ")", "round"],
  ["{", "}", "diamond"],
];

/**
 * อ่าน "id + รูปร่าง" 1 ชิ้น ณ ตำแหน่งที่กำหนด
 * คืน null ถ้าตรงนั้นไม่มี id — แยก shape ออกมาเพื่อไม่ให้ "ข้อความ" ที่มีวงเล็บกลายเป็น node
 */
function readNode(s: string, i: number): { id: string; shape: Shape; label: string; end: number } | null {
  const m = /^[A-Za-z0-9_]+/.exec(s.slice(i));
  if (!m) return null;
  const id = m[0];
  let j = i + id.length;
  while (s[j] === " ") j++;
  for (const [open, close, shape] of OPENERS) {
    if (s.substr(j, open.length) !== open) continue;
    const from = j + open.length;
    const endIdx = s.indexOf(close, from);
    if (endIdx < 0) break;
    return { id, shape, label: cleanLabel(s.slice(from, endIdx)), end: endIdx + close.length };
  }
  return null;
}

export function parseMermaid(src: string): { nodes: MNode[]; edges: MEdge[] } {
  let t = String(src || "").replace(/```[a-zA-Z]*|```/g, " ");
  t = t.replace(/^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*/i, "");
  t = t
    .split("\n")
    .map((l) => l.replace(/%%.*$/, "").replace(/;+\s*$/, "").trim())
    .filter(Boolean)
    .join("\n");
  if (!t) return { nodes: [], edges: [] };

  const nodes = new Map<string, MNode>();

  // รอบ 1: ดึง "id[รูปร่าง]" ทุกตัวออกมาก่อน แล้วแทนที่ด้วย id เปล่า
  // (Mermaid เขียนประกาศ node คนละบรรทัดได้ ไม่งั้น parser แบบเดินตามลูกศรจะตกหล่น)
  let cleaned = "";
  for (let i = 0; i < t.length; ) {
    const n = readNode(t, i);
    if (n) {
      const prev = nodes.get(n.id);
      if (!prev) nodes.set(n.id, { id: n.id, label: n.label, shape: n.shape });
      else if (n.label) prev.label = n.label;
      cleaned += n.id;
      i = n.end;
      continue;
    }
    cleaned += t[i];
    i++;
  }

  // รอบ 2: อ่านเส้นเชื่อมจากข้อความที่เหลือแต่ id
  // ต้องแยกทีละบรรทัดก่อน ไม่งั้นบรรทัดประกาศ node จะถูกปนไปกับเส้นเชื่อมและทำให้ชั้นผิด
  const edges: MEdge[] = [];
  const ensure = (raw: string): string => {
    const id = (String(raw || "").trim().match(/[A-Za-z0-9_]+/) || [""])[0];
    if (!id) return "";
    if (!nodes.has(id)) nodes.set(id, { id, label: id, shape: "rect" });
    return id;
  };

  for (const line of cleaned.split("\n")) {
    const l = line.trim();
    if (!l || l.indexOf("-") < 0) continue;      // บรรทัดนี้ไม่มีลูกศร = บรรทัดประกาศ node อย่างเดียว

    let prev = "";
    for (const part of l.split(/-+>/)) {
      let c = part.trim();
      let label = "";
      const lm = c.match(/^\|([^|]*)\|\s*([\s\S]*)$/);
      if (lm) {
        label = cleanLabel(lm[1]);
        c = lm[2].trim();
      }
      const idm = c.match(/[A-Za-z0-9_]+/);
      if (!idm) continue;
      const id = ensure(idm[0]);
      if (prev && id && prev !== id) edges.push({ from: prev, to: id, label });
      prev = id;
    }
  }

  return { nodes: [...nodes.values()], edges };
}

type Box = MNode & { x: number; y: number; w: number; h: number; lines: string[]; layer: number };

function measure(n: MNode) {
  const lines = (n.label || n.id).split("\n").filter((l) => l.trim().length) || [n.id];
  const tw = Math.max(...lines.map(textWidth));
  const linesH = lines.length * LH;
  if (n.shape === "diamond") {
    return { lines, w: Math.max(MIN_W + 24, tw * 1.5 + 44), h: linesH + 34 };
  }
  if (n.shape === "io") {
    return { lines, w: Math.max(MIN_W, tw + PAD_X * 2) + 30, h: linesH + PAD_Y * 2 };
  }
  const w = Math.max(MIN_W, tw + PAD_X * 2);
  const h = linesH + PAD_Y * 2;
  return { lines, w: n.shape === "stadium" ? w + 18 : w, h };
}

function layout(nodes: MNode[], edges: MEdge[]) {
  const sizes = new Map<string, ReturnType<typeof measure>>();
  nodes.forEach((n) => sizes.set(n.id, measure(n)));

  // ชั้น = เส้นทางยาวสุดจากต้นไป (กันวนได้ 8 รอบ)
  const layer = new Map<string, number>();
  nodes.forEach((n) => layer.set(n.id, 0));
  const inc = new Map<string, string[]>();
  edges.forEach((e) => inc.set(e.to, [...(inc.get(e.to) || []), e.from]));

  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const e of edges) {
      const a = layer.get(e.from) ?? 0;
      const b = layer.get(e.to) ?? 0;
      if (a + 1 > b) { layer.set(e.to, a + 1); changed = true; }
    }
    if (!changed) break;
  }

  const order = new Map<string, number>();
  nodes.forEach((n, i) => order.set(n.id, i));

  const byLayer = new Map<number, Box[]>();
  for (const n of nodes) {
    const L = layer.get(n.id) ?? 0;
    const s = sizes.get(n.id)!;
    const box: Box = { ...n, ...s, x: 0, y: 0, layer: L };
    byLayer.set(L, [...(byLayer.get(L) || []), box]);
  }

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  for (const L of layers) byLayer.get(L)!.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));

  // กว้างแต่ละชั้น แล้วจัดกึ่งกลาง
  const rowW = layers.map((L) => {
    const arr = byLayer.get(L)!;
    return arr.reduce((s, b) => s + b.w, 0) + Math.max(0, arr.length - 1) * GAP_X;
  });
  const totalW = Math.max(320, ...rowW);

  let y = 8;
  const boxes: Box[] = [];
  layers.forEach((L, li) => {
    const arr = byLayer.get(L)!;
    const w = rowW[li];
    let x = (totalW - w) / 2;
    const rowH = Math.max(...arr.map((b) => b.h));
    for (const b of arr) {
      boxes.push({ ...b, x, y: y + (rowH - b.h) / 2 });
      x += b.w + GAP_X;
    }
    y += rowH + GAP_Y;
  });

  return { boxes, edges, totalW, totalH: Math.max(60, y - GAP_Y + 8) };
}

const STROKE = "#94a3b8";
const FILL_START = "#dcfce7";
const FILL_BOX = "#eff6ff";
const FILL_DECIDE = "#fef3c7";
const FILL_END = "#f1f5f9";
const TEXT = "#0f172a";
const SL = 18;   // เยื้อพาราแลลเลล้รม

export default function MermaidFlow({ code }: { code: string }) {
  const winW = useWindowDimensions().width;
  const model = useMemo(() => {
    const { nodes, edges } = parseMermaid(code);
    if (nodes.length < 2) return null;
    return layout(nodes, edges);
  }, [code]);

  if (!model) {
    // วาดไม่ได้ = โชว์โค้ดดิบไว้ อย่างทำให้ผู้ใช้ไม่เห็นอะไรเลย
    return (
      <View style={st.fallback}>
        <Text style={st.fallbackText}>{String(code || "").trim()}</Text>
      </View>
    );
  }

  const { boxes, edges, totalW, totalH } = model;
  const at = new Map(boxes.map((b) => [b.id, b]));

  // ผังกว้างเกินกล่องแชท = ย่อให้พอดีก่อน ไม่งั้นผู้ใช้เห็นแค่เศษเดียว
  // ถ้าย่อแล้วยังเล็กกว่าขั้นต่ำ (อ่านไม่ออก) ค่อยให้เลื่อนแนวนอน
  const availW = Math.max(240, winW - 64);
  const scale = Math.max(MIN_SCALE, Math.min(1, availW / totalW));
  const fits = totalW * scale <= availW + 1;

  const bg = (b: Box) =>
    b.layer === 0 ? FILL_START
      : b.shape === "diamond" ? FILL_DECIDE
        : b.shape === "stadium" ? FILL_END
          : FILL_BOX;

  const edgePath = (e: MEdge) => {
    const a = at.get(e.from), b = at.get(e.to);
    if (!a || !b) return null;
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;

    if (b.layer > a.layer) {
      if (Math.abs(x1 - x2) < 1) return { d: `M ${x1} ${y1} L ${x2} ${y2 - 4}`, lx: x1, ly: (y1 + y2) / 2 };
      const my = y1 + (y2 - y1) / 2;
      return { d: `M ${x1} ${y1} V ${my} H ${x2} V ${y2 - 4}`, lx: (x1 + x2) / 2, ly: my };
    }

    // เส้นย้อนกลับ (loop) = ออกด้านข้างแล้ววนกลับเข้าด้านบน
    const right = Math.max(a.x + a.w, b.x + b.w) + 26;
    return {
      d: `M ${x1} ${y1} V ${y1 + 18} H ${right} V ${y2 - 18} H ${x2} V ${y2 - 4}`,
      lx: right - 4,
      ly: y1 + 18,
    };
  };

  const body = (
    <>
            <Defs>
              <Marker id="mfa" markerWidth={9} markerHeight={9} refX={8} refY={3} orient="auto" markerUnits="strokeWidth">
                <Path d="M0,0 L0,6 L8,3 z" fill={STROKE} />
              </Marker>
            </Defs>
  
            {/* เส้นเชื่อมวาดก่อน ให้กล่องทับปลายเส้น */}
            {edges.map((e, i) => {
              const p = edgePath(e);
              if (!p) return null;
              return (
                <G key={`e${i}`}>
                  <Path d={p.d} stroke={STROKE} strokeWidth={1.8} fill="none" markerEnd="url(#mfa)" />
                  {e.label ? (
                    <>
                      <Rect x={p.lx - (e.label.length * 4 + 8) / 2} y={p.ly - 9} width={e.label.length * 4 + 8} height={17} rx={5} fill="#ffffff" stroke="#e2e8f0" />
                      <SvgText x={p.lx} y={p.ly + 3.5} fontSize={11} fill="#475569" textAnchor="middle" fontWeight="600">
                        {e.label}
                      </SvgText>
                    </>
                  ) : null}
                </G>
              );
            })}
  
            {boxes.map((b) => {
              const cx = b.x + b.w / 2;
              const cy = b.y + b.h / 2;
              const stroke = b.layer === 0 ? "#16a34a" : b.shape === "diamond" ? "#d97706" : "#64748b";
              const fill = bg(b);
              return (
                <G key={b.id}>
                  {b.shape === "io" ? (
                    <Polygon
                      points={`${b.x + SL},${b.y} ${b.x + b.w},${b.y} ${b.x + b.w - SL},${b.y + b.h} ${b.x},${b.y + b.h}`}
                      fill={fill} stroke={stroke} strokeWidth={1.8}
                    />
                  ) : b.shape === "diamond" ? (
                    <Polygon
                      points={`${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}`}
                      fill={fill} stroke={stroke} strokeWidth={1.8}
                    />
                  ) : (
                    <Rect
                      x={b.x} y={b.y} width={b.w} height={b.h}
                      rx={b.shape === "stadium" ? b.h / 2 : b.shape === "round" ? 14 : 8}
                      fill={fill} stroke={stroke} strokeWidth={1.8}
                    />
                  )}
                  {b.shape === "stadium" ? <Circle cx={b.x + 13} cy={cy} r={4} fill="#fff" stroke={stroke} strokeWidth={1.6} /> : null}
                  {b.lines.map((ln, li) => (
                    <SvgText
                      key={li}
                      x={cx} y={b.y + b.h / 2 - ((b.lines.length - 1) * LH) / 2 + li * LH + 4.5}
                      fontSize={FS} fill={TEXT} textAnchor="middle" fontWeight="600"
                    >
                      {ln}
                    </SvgText>
                  ))}
                </G>
              );
            })}
    </>
  );

  return (
    <View style={st.wrap}>
      {fits ? (
        <View style={{ alignItems: "center" }}>
          <Svg width={Math.round(totalW * scale)} height={Math.round(totalH * scale)} viewBox={`0 0 ${totalW} ${totalH}`}>
            {body}
          </Svg>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Svg width={totalW} height={totalH}>{body}</Svg>
        </ScrollView>
      )}
      <Text style={st.hint}>{fits ? `ย่อให้พอดีกว้าง ${Math.round(scale * 100)}%` : "เลื่อนซ้าย–ขวาเพื่อดูทั้งผัง"}</Text>
    </View>
  );
};

const st = StyleSheet.create({
  wrap: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  hint: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 6,
  },
  fallback: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  fallbackText: {
    color: "#e2e8f0",
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 17,
  },
});
