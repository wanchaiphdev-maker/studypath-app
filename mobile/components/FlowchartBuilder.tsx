import React, { useMemo, useRef, useState } from "react";
import {
  Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import Svg, { Circle, Defs, Ellipse, Marker, Path, Polygon, Rect } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { colors, font } from "../lib/theme";

type ShapeKind =
  | "process" | "alternateProcess" | "decision" | "data" | "predefinedProcess" | "internalStorage"
  | "document" | "multiDocument" | "terminator" | "preparation" | "manualInput" | "manualOperation"
  | "connector" | "offPageConnector" | "card" | "punchedTape" | "summingJunction" | "or"
  | "collate" | "sort" | "extract" | "merge" | "storedData" | "delay"
  | "sequentialAccessStorage" | "magneticDisk" | "directAccessStorage" | "display";
type LineKind = "straight" | "elbow" | "curved";
type ArrowKind = "forward" | "none" | "both";
type FlowNode = { id: string; kind: ShapeKind; label: string; x: number; y: number; w: number; h: number };
type FlowPort = "top" | "right" | "bottom" | "left";
type FlowEdge = { id: string; from: string; to: string; fromSide: FlowPort; toSide: FlowPort; label: string; line: LineKind; arrow: ArrowKind };
type FlowHistory = { nodes: FlowNode[]; edges: FlowEdge[] };

const GRID = 24;
const NODE_W = 152;
const NODE_H = 72;
const CANVAS_H = 1200;
const WheelView: React.ComponentType<any> = View;
const SHAPES: { kind: ShapeKind; label: string; initial: string }[] = [
  { kind: "process", label: "กระบวนการ (Process)", initial: "" },
  { kind: "alternateProcess", label: "กระบวนการทางเลือก (Alternate Process)", initial: "" },
  { kind: "decision", label: "การตัดสินใจ (Decision)", initial: "" },
  { kind: "data", label: "ข้อมูล (Data)", initial: "" },
  { kind: "predefinedProcess", label: "กระบวนการย่อย (Predefined Process)", initial: "" },
  { kind: "internalStorage", label: "ที่เก็บข้อมูลภายใน (Internal Storage)", initial: "" },
  { kind: "document", label: "เอกสาร (Document)", initial: "" },
  { kind: "multiDocument", label: "หลายเอกสาร (Multidocument)", initial: "" },
  { kind: "terminator", label: "เริ่มต้น / สิ้นสุด (Terminator)", initial: "" },
  { kind: "preparation", label: "การเตรียมการ (Preparation)", initial: "" },
  { kind: "manualInput", label: "ป้อนข้อมูลด้วยมือ (Manual Input)", initial: "" },
  { kind: "manualOperation", label: "การทำงานด้วยมือ (Manual Operation)", initial: "" },
  { kind: "connector", label: "จุดเชื่อม (Connector)", initial: "" },
  { kind: "offPageConnector", label: "จุดเชื่อมข้ามหน้า (Off-page Connector)", initial: "" },
  { kind: "card", label: "บัตร (Card)", initial: "" },
  { kind: "punchedTape", label: "เทปเจาะรู (Punched Tape)", initial: "" },
  { kind: "summingJunction", label: "จุดรวมผลรวม (Summing Junction)", initial: "" },
  { kind: "or", label: "หรือ (Or)", initial: "" },
  { kind: "collate", label: "จัดเรียงรวม (Collate)", initial: "" },
  { kind: "sort", label: "เรียงลำดับ (Sort)", initial: "" },
  { kind: "extract", label: "แยกข้อมูล (Extract)", initial: "" },
  { kind: "merge", label: "รวมข้อมูล (Merge)", initial: "" },
  { kind: "storedData", label: "จัดเก็บข้อมูล (Store Data)", initial: "" },
  { kind: "delay", label: "หน่วงเวลา (Delay)", initial: "" },
  { kind: "sequentialAccessStorage", label: "ที่เก็บข้อมูลตามลำดับ (Sequential Access Storage)", initial: "" },
  { kind: "magneticDisk", label: "ดิสก์แม่เหล็ก (Magnetic Disk)", initial: "" },
  { kind: "directAccessStorage", label: "ที่เก็บข้อมูลเข้าถึงโดยตรง (Direct Access Storage)", initial: "" },
  { kind: "display", label: "จอแสดงผล (Display)", initial: "" },
];

const snap = (n: number) => Math.max(GRID, Math.round(n / GRID) * GRID);
const safeLabel = (s: string) => String(s || "").replace(/[\[\]{}()]/g, " ").replace(/\s+/g, " ").trim() || "ขั้นตอน";

function drawShape(kind: ShapeKind, w: number, h: number, fill: string, stroke: string, sw = 2) {
  const x = 3, y = 3, rw = w - 6, rh = h - 6, mid = w / 2;
  const common = { fill, stroke, strokeWidth: sw, strokeLinejoin: "round" as const };
  switch (kind) {
    case "terminator": return <Rect x={x} y={y + h * .18} width={rw} height={rh * .64} rx={rh * .32} {...common} />;
    case "alternateProcess": return <><Rect x={x + 8} y={y} width={rw - 16} height={rh} {...common} /><Path d={`M${x + 16} ${y}V${y + rh} M${x + rw - 16} ${y}V${y + rh}`} {...common} fill="none" /></>;
    case "decision": case "sort": return <><Polygon points={`${mid},${y} ${w - x},${h / 2} ${mid},${h - y} ${x},${h / 2}`} {...common} />{kind === "sort" ? <Path d={`M${x + 18} ${h / 2}H${w - 18}`} {...common} fill="none" /> : null}</>;
    case "data": return <Polygon points={`${x + 20},${y} ${w - x},${y} ${w - 20},${h - y} ${x},${h - y}`} {...common} />;
    case "predefinedProcess": return <><Rect x={x} y={y + 7} width={rw} height={rh - 14} {...common} /><Path d={`M${x + 15} ${y + 7}V${h - y - 7} M${w - x - 15} ${y + 7}V${h - y - 7}`} {...common} fill="none" /></>;
    case "internalStorage": return <><Rect x={x} y={y} width={rw} height={rh} {...common} /><Path d={`M${x + 15} ${y}V${y + 15} M${x} ${y + 15}H${x + 15}`} {...common} fill="none" /></>;
    case "document": return <><Path d={`M${x} ${y}H${w - x}V${h - 15} C${w * .72} ${h + 2},${w * .4} ${h - 25},${x} ${h - 8} Z`} {...common} /></>;
    case "multiDocument": return <><Path d={`M${x + 14} ${y + 8}H${w - x - 8}V${h - 14} Q${w * .55} ${h + 3},${x + 14} ${h - 8}Z`} {...common} /><Path d={`M${x + 7} ${y + 4}H${w - x - 14}V${h - 14}`} {...common} fill="none" /><Path d={`M${x} ${y}H${w - x - 20}V${h - 14}`} {...common} fill="none" /></>;
    case "preparation": return <Polygon points={`${x + 18},${y} ${w - x - 18},${y} ${w - x},${h / 2} ${w - x - 18},${h - y} ${x + 18},${h - y} ${x},${h / 2}`} {...common} />;
    case "manualInput": return <Polygon points={`${x + 18},${y + 13} ${w - x},${y} ${w - x},${h - y} ${x},${h - y} ${x},${y + 13}`} {...common} />;
    case "manualOperation": return <Polygon points={`${x},${y} ${w - x},${y} ${w - 20},${h - y} ${x + 20},${h - y}`} {...common} />;
    case "connector": return <Circle cx={mid} cy={h / 2} r={Math.min(w, h) * .38} {...common} />;
    case "offPageConnector": return <Polygon points={`${x},${y} ${w - x},${y} ${w - x},${h * .62} ${mid},${h - y} ${x},${h * .62}`} {...common} />;
    case "card": return <Path d={`M${x} ${y}H${w - 22}L${w - x} ${y + 22}V${h - y}H${x}Z M${w - 22} ${y}V${y + 22}H${w - x}`} {...common} />;
    case "punchedTape": return <Path d={`M${x} ${y + 8} Q${w * .25} ${y - 6},${w * .5} ${y + 8} T${w - x} ${y + 8} V${h - 8} Q${w * .75} ${h + 6},${w * .5} ${h - 8} T${x} ${h - 8}Z`} {...common} />;
    case "summingJunction": return <><Circle cx={mid} cy={h / 2} r={Math.min(w, h) * .38} {...common} /><Path d={`M${mid - 13} ${h / 2}H${mid + 13} M${mid} ${h / 2 - 13}V${h / 2 + 13}`} {...common} fill="none" /></>;
    case "or": return <><Circle cx={mid} cy={h / 2} r={Math.min(w, h) * .38} {...common} /><Path d={`M${mid - 13} ${h / 2}H${mid + 13}`} {...common} fill="none" /></>;
    case "collate": return <Polygon points={`${x},${y} ${w - x},${y} ${mid},${h - y}`} {...common} />;
    case "extract": return <Polygon points={`${mid},${y} ${w - x},${h - y} ${x},${h - y}`} {...common} />;
    case "merge": return <Polygon points={`${x},${y} ${w - x},${y} ${mid},${h - y}`} {...common} />;
    case "storedData": return <><Path d={`M${x + 10} ${y + 6} Q${mid} ${y - 4},${w - x - 10} ${y + 6} L${w - x - 10} ${h - 12} Q${mid} ${h + 2},${x + 10} ${h - 12}Z`} {...common} /><Path d={`M${x + 10} ${y + 6}Q${mid} ${y + 18},${w - x - 10} ${y + 6}`} {...common} fill="none" /></>;
    case "delay": return <><Path d={`M${x} ${y}H${mid} A${rh / 2} ${rh / 2} 0 0 1 ${mid} ${h - y} H${x}Z`} {...common} /></>;
    case "sequentialAccessStorage": return <><Path d={`M${x + 18} ${y + 10} C${x - 5} ${y + 14},${x - 2} ${h - 7},${mid} ${h - 7} C${w - x + 2} ${h - 7},${w - x + 5} ${y + 14},${w - x - 18} ${y + 10}`} {...common} fill="none" /><Path d={`M${x + 19} ${y + 10}H${w - x - 19} M${x + 20} ${y + 10}V${h / 2} M${w - x - 20} ${y + 10}V${h / 2}`} {...common} fill="none" /></>;
    case "magneticDisk": return <><Path d={`M${x + 10} ${y + 10} Q${mid} ${y - 2},${w - x - 10} ${y + 10} V${h - 12} Q${mid} ${h + 2},${x + 10} ${h - 12}Z`} {...common} /><Path d={`M${x + 10} ${y + 10} Q${mid} ${y + 22},${w - x - 10} ${y + 10}`} {...common} fill="none" /><Ellipse cx={mid} cy={h - 13} rx={rw * .35} ry={5} fill="none" stroke={stroke} strokeWidth={sw} /></>;
    case "directAccessStorage": return <><Path d={`M${x + 8} ${y + 10} Q${mid} ${y - 4},${w - x - 8} ${y + 10} V${h - 10} Q${mid} ${h + 4},${x + 8} ${h - 10}Z`} {...common} /><Path d={`M${x + 8} ${y + 10}Q${mid} ${y + 24},${w - x - 8} ${y + 10} M${x + 8} ${h - 10}Q${mid} ${h - 23},${w - x - 8} ${h - 10}`} {...common} fill="none" /></>;
    case "display": return <Path d={`M${x} ${y} H${w - 28} Q${w - x} ${h / 2},${w - 28} ${h - y} H${x} Z`} {...common} />;
    default: return <Rect x={x} y={y} width={rw} height={rh} rx={8} {...common} />;
  }
}

function toMermaid(nodes: FlowNode[], edges: FlowEdge[]) {
  if (!nodes.length) return "";
  const shape = (n: FlowNode) => n.kind === "terminator" ? `([${safeLabel(n.label)}])`
    : n.kind === "decision" || n.kind === "sort" ? `{${safeLabel(n.label)}}`
      : ["data", "manualInput", "display"].includes(n.kind) ? `[/${safeLabel(n.label)}/]`
        : `[${safeLabel(n.label)}]`;
  const arrow = (e: FlowEdge) => e.arrow === "none" ? "---" : e.arrow === "both" ? "<-->" : "-->";
  const lines = ["flowchart TD", ...nodes.map((n) => `${n.id}${shape(n)}`)];
  for (const e of edges) {
    const link = arrow(e);
    lines.push(e.label.trim() ? `${e.from} ${link}|${safeLabel(e.label)}| ${e.to}` : `${e.from} ${link} ${e.to}`);
  }
  return lines.join("\n");
}

function portPoint(node: FlowNode, side: FlowPort) {
  if (side === "top") return { x: node.x + node.w / 2, y: node.y };
  if (side === "right") return { x: node.x + node.w, y: node.y + node.h / 2 };
  if (side === "bottom") return { x: node.x + node.w / 2, y: node.y + node.h };
  return { x: node.x, y: node.y + node.h / 2 };
}

function edgePath(a: FlowNode, b: FlowNode, line: LineKind, fromSide: FlowPort, toSide: FlowPort) {
  const { x: sx, y: sy } = portPoint(a, fromSide);
  const { x: ex, y: ey } = portPoint(b, toSide);
  const horizontal = fromSide === "left" || fromSide === "right";
  const dx = ex - sx, dy = ey - sy;
  if (line === "straight") return `M ${sx} ${sy} L ${ex} ${ey}`;
  if (line === "curved") {
    const bend = horizontal ? Math.max(28, Math.abs(ex - sx) * 0.45) : Math.max(28, Math.abs(ey - sy) * 0.45);
    return horizontal
      ? `M ${sx} ${sy} C ${sx + Math.sign(dx) * bend} ${sy}, ${ex - Math.sign(dx) * bend} ${ey}, ${ex} ${ey}`
      : `M ${sx} ${sy} C ${sx} ${sy + Math.sign(dy) * bend}, ${ex} ${ey - Math.sign(dy) * bend}, ${ex} ${ey}`;
  }
  if (horizontal) {
    const mid = (sx + ex) / 2;
    return `M ${sx} ${sy} H ${mid} V ${ey} H ${ex}`;
  }
  const mid = (sy + ey) / 2;
  return `M ${sx} ${sy} V ${mid} H ${ex} V ${ey}`;
}

function PaletteItem({ item, onAdd, onDrop }: {
  item: typeof SHAPES[number];
  onAdd: (kind: ShapeKind) => void;
  onDrop: (kind: ShapeKind, x: number, y: number) => void;
}) {
  const drag = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 7 || Math.abs(g.dy) > 7,
    onPanResponderRelease: (_e, g) => onDrop(item.kind, g.moveX, g.moveY),
  })).current;
  return <Pressable onPress={() => onAdd(item.kind)} {...drag.panHandlers} style={styles.paletteItem}>
    <Svg width={44} height={28} viewBox="0 0 152 72">{drawShape(item.kind, 152, 72, "#ffffff", "#7c68df", 4)}</Svg>
    <Text numberOfLines={2} style={styles.paletteText}>{item.label}</Text>
  </Pressable>;
}

function ConnectionPort({ side, scale, onStart, onMove, onEnd }: {
  side: FlowPort; scale: number;
  onStart: (side: FlowPort) => void;
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
}) {
  const latest = useRef({ side, onStart, onMove, onEnd });
  latest.current = { side, onStart, onMove, onEnd };
  const pointerActive = useRef(false);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => latest.current.onStart(latest.current.side),
    onPanResponderMove: (_e, g) => latest.current.onMove(g.moveX, g.moveY),
    onPanResponderRelease: (_e, g) => latest.current.onEnd(g.moveX, g.moveY),
  })).current;
  const portSize = Math.max(16, Math.min(30, 20 * scale));
  const halfPort = -portSize / 2;
  const portPosition = side === "top" ? { top: halfPort, left: "50%", marginLeft: halfPort }
    : side === "right" ? { right: halfPort, top: "50%", marginTop: halfPort }
      : side === "bottom" ? { bottom: halfPort, left: "50%", marginLeft: halfPort }
        : { left: halfPort, top: "50%", marginTop: halfPort };
  return <WheelView
    testID={`flowchart-port-${side}`}
    style={[styles.connectionPort, portPosition, { width: portSize, height: portSize }]}
    onPointerDown={(event: any) => {
      if (event.pointerType !== "mouse") return;
      event.preventDefault?.(); event.stopPropagation?.();
      pointerActive.current = true;
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      latest.current.onStart(latest.current.side);
    }}
    onPointerMove={(event: any) => { if (pointerActive.current) latest.current.onMove(event.clientX, event.clientY); }}
    onPointerUp={(event: any) => { if (pointerActive.current) { pointerActive.current = false; latest.current.onEnd(event.clientX, event.clientY); } }}
    onPointerCancel={(event: any) => { if (pointerActive.current) { pointerActive.current = false; latest.current.onEnd(event.clientX, event.clientY); } }}
    {...pan.panHandlers}
  />;
}

function DraggableNode({ node, selected, scale, connectMode, onSelect, onTap, onMove, onDrop, onMoveStart, onResize, onResizeStart, onDelete, onLabelChange, onEditStart, onConnectStart, onConnectMove, onConnectEnd }: {
  node: FlowNode; selected: boolean; scale: number; connectMode: boolean;
  onSelect: (id: string) => void; onTap: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void; onDrop: (id: string, x: number, y: number) => void;
  onMoveStart: () => void; onResize: (id: string, w: number, h: number) => void; onResizeStart: () => void; onDelete: (id: string) => void;
  onLabelChange: (id: string, label: string) => void; onEditStart: (id: string) => void;
  onConnectStart: (id: string, side: FlowPort) => void; onConnectMove: (x: number, y: number) => void; onConnectEnd: (x: number, y: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const lastTap = useRef(0);
  const connectModeRef = useRef(connectMode);
  connectModeRef.current = connectMode;
  const latest = useRef({ node, onSelect, onTap, onMove, onDrop, onMoveStart, onResize, onResizeStart, scale });
  latest.current = { node, onSelect, onTap, onMove, onDrop, onMoveStart, onResize, onResizeStart, scale };
  const origin = useRef({ x: node.x, y: node.y });
  const moved = useRef(false);
  const historySaved = useRef(false);
  const isControlTarget = (event: any) => !!event?.nativeEvent?.target?.closest?.('[data-testid="flowchart-node-input"], [data-testid^="flowchart-port-"], [data-testid="flowchart-node-delete"], [data-testid="flowchart-node-resize"]');
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: (e) => !isControlTarget(e),
    onMoveShouldSetPanResponder: (e, g) => !isControlTarget(e) && (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5),
    onPanResponderGrant: () => {
      const current = latest.current;
      origin.current = { x: current.node.x, y: current.node.y };
      moved.current = false; historySaved.current = false;
      current.onSelect(current.node.id);
    },
    onPanResponderMove: (_e, g) => {
      if (Math.abs(g.dx) + Math.abs(g.dy) > 4) {
        moved.current = true;
        if (!historySaved.current) { historySaved.current = true; latest.current.onMoveStart(); }
      }
      const current = latest.current;
      current.onMove(current.node.id, origin.current.x + g.dx / current.scale, origin.current.y + g.dy / current.scale);
    },
    onPanResponderRelease: (_e, g) => {
      const current = latest.current;
      if (moved.current) current.onDrop(current.node.id, origin.current.x + g.dx / current.scale, origin.current.y + g.dy / current.scale);
      else {
        current.onTap(current.node.id);
        const now = Date.now();
        if (!connectModeRef.current && now - lastTap.current < 380) {
          setEditing(true);
          requestAnimationFrame(() => inputRef.current?.focus());
          lastTap.current = 0;
        } else lastTap.current = now;
      }
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  const resizeOrigin = useRef({ w: node.w, h: node.h });
  const resizePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { resizeOrigin.current = { w: latest.current.node.w, h: latest.current.node.h }; latest.current.onSelect(latest.current.node.id); latest.current.onResizeStart(); },
    onPanResponderMove: (_e, g) => latest.current.onResize(latest.current.node.id, Math.max(100, resizeOrigin.current.w + g.dx / latest.current.scale), Math.max(58, resizeOrigin.current.h + g.dy / latest.current.scale)),
  })).current;

  const stroke = connectMode ? "#14b8a6" : selected ? "#6d5ce7" : "#8090aa";
  const fill = selected ? "#f1edff" : "#ffffff";
  const shape = drawShape(node.kind, node.w, node.h, fill, stroke, 2);
  const sizeRatio = Math.max(0.72, Math.min(2.5, Math.sqrt((node.w * node.h) / (NODE_W * NODE_H))));
  const inputWidth = (node.w - 16) * scale;
  const inputHeight = (node.h - 8) * scale;
  return <WheelView
    testID="flowchart-node"
    style={[styles.nodeWrap, { left: node.x * scale, top: node.y * scale, width: node.w * scale, height: node.h * scale, cursor: "move" }]}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onDoubleClick={() => { if (!connectMode) { setEditing(true); requestAnimationFrame(() => inputRef.current?.focus()); } }}
    {...pan.panHandlers}
  >
    <Svg width={node.w * scale} height={node.h * scale} viewBox={`0 0 ${node.w} ${node.h}`} pointerEvents="none">{shape}</Svg>
    <TextInput
      ref={inputRef}
      testID="flowchart-node-input"
      value={node.label}
      onFocus={() => { onSelect(node.id); onEditStart(node.id); }}
      onBlur={() => setEditing(false)}
      onChangeText={(label) => onLabelChange(node.id, label)}
      placeholder=""
      multiline
      editable={editing && !connectMode}
      pointerEvents={editing && !connectMode ? "auto" : "none"}
      textAlign="center"
      cursorColor="#6d35d9"
      selectionColor="#6d35d9"
      style={[styles.nodeInput, { left: (node.w * scale - inputWidth) / 2, top: (node.h * scale - inputHeight) / 2, width: inputWidth, height: inputHeight, fontSize: Math.max(14, 13 * sizeRatio * scale), lineHeight: Math.max(16, 16 * sizeRatio * scale), outlineStyle: "none" } as any, selected && { color: "#5b45c5" }]}
    />
    {(["top", "right", "bottom", "left"] as FlowPort[]).map((port) => <ConnectionPort key={port} side={port} scale={scale} onStart={(sideName) => onConnectStart(node.id, sideName)} onMove={onConnectMove} onEnd={onConnectEnd} />)}
    {selected || hovered ? <Pressable testID="flowchart-node-delete" onPress={() => onDelete(node.id)} style={[styles.nodeDelete, { transform: [{ scale }] }]}><Ionicons name="close" size={18} color="#fff" /></Pressable> : null}
    {selected ? <View testID="flowchart-node-resize" style={[styles.resizeHandle, styles.resizeDragTarget, { transform: [{ scale }] }]} {...resizePan.panHandlers}><Ionicons name="resize-outline" size={16} color="#fff" /></View> : null}
  </WheelView>;
}

export default function FlowchartBuilder({ question, feedback, busy, onChange, onCheck, onNext, onBack }: {
  question: string;
  feedback?: string;
  busy?: boolean;
  onChange: (value: string) => void;
  onCheck: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const canvasWidth = Math.max(1600, Math.floor(screenWidth * 1.55));
  const sideWidth = screenWidth > 1100 ? 210 : screenWidth > 760 ? 180 : 148;
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [symbolMenu, setSymbolMenu] = useState(true);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [newLine, setNewLine] = useState<LineKind>("elbow");
  const [newArrow, setNewArrow] = useState<ArrowKind>("forward");
  const [connectionMenu, setConnectionMenu] = useState(false);
  const [connectionDrag, setConnectionDrag] = useState<{ from: string; side: FlowPort; x: number; y: number } | null>(null);
  const [undoStack, setUndoStack] = useState<FlowHistory[]>([]);
  const [redoStack, setRedoStack] = useState<FlowHistory[]>([]);
  const [zoom, setZoom] = useState(0.72);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: "pan" | "pinch"; x: number; y: number; panX: number; panY: number; distance: number; zoom: number } | null>(null);
  const canvasRef = useRef<View>(null);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  React.useEffect(() => { onChange(toMermaid(nodes, edges)); }, [nodes, edges, onChange]);

  function saveUndo() {
    setUndoStack((current) => [...current.slice(-39), { nodes, edges }]);
    setRedoStack([]);
  }

  function undo() {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((current) => [...current, { nodes, edges }]);
    setUndoStack((current) => current.slice(0, -1));
    setNodes(previous.nodes); setEdges(previous.edges); setSelectedNode(null);
  }

  function redo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((current) => [...current, { nodes, edges }]);
    setRedoStack((current) => current.slice(0, -1));
    setNodes(next.nodes); setEdges(next.edges); setSelectedNode(null);
  }

  function addNode(kind: ShapeKind, x?: number, y?: number) {
    if (!SHAPES.some((s) => s.kind === kind)) return;
    const id = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
    const px = x === undefined ? snap((canvasWidth - NODE_W) / 2) : snap(x);
    const py = y === undefined ? snap(80 + nodes.length * 96) : snap(y);
    const node: FlowNode = { id, kind, label: "", x: Math.max(GRID, Math.min(canvasWidth - NODE_W - GRID, px)), y: Math.max(GRID, Math.min(CANVAS_H - NODE_H - GRID, py)), w: NODE_W, h: NODE_H };
    saveUndo();
    setNodes((current) => [...current, node]);
    setSelectedNode(id);
  }

  function dropPalette(kind: ShapeKind, pageX: number, pageY: number) {
    canvasRef.current?.measureInWindow((x, y, width, height) => {
      if (pageX < x || pageX > x + width || pageY < y || pageY > y + height) return;
      addNode(kind, (pageX - x - NODE_W * zoom / 2) / zoom, (pageY - y - NODE_H * zoom / 2) / zoom);
    });
  }

  function changeZoom(next: number) { setZoom(Math.max(0.35, Math.min(1.8, Math.round(next * 100) / 100))); }
  function resetView() { panRef.current = { x: 0, y: 0 }; setPan({ x: 0, y: 0 }); changeZoom(0.72); }
  function pointerDistance() {
    const active = [...pointers.current.values()];
    if (active.length < 2) return 0;
    const dx = active[0].x - active[1].x, dy = active[0].y - active[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function handleCanvasPointerDown(event: any) {
    if (event.target?.closest?.('[data-testid="flowchart-node"]')) return;
    event.preventDefault?.();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      gesture.current = { mode: "pinch", x: 0, y: 0, panX: panRef.current.x, panY: panRef.current.y, distance: pointerDistance(), zoom };
    } else {
      gesture.current = { mode: "pan", x: event.clientX, y: event.clientY, panX: panRef.current.x, panY: panRef.current.y, distance: 0, zoom };
    }
  }
  function handleCanvasPointerMove(event: any) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const activeGesture = gesture.current;
    if (activeGesture.mode === "pinch") {
      const distance = pointerDistance();
      if (activeGesture.distance > 0 && distance > 0) changeZoom(activeGesture.zoom * distance / activeGesture.distance);
      return;
    }
    const nextPan = { x: activeGesture.panX + event.clientX - activeGesture.x, y: activeGesture.panY + event.clientY - activeGesture.y };
    panRef.current = nextPan;
    setPan(nextPan);
  }
  function handleCanvasPointerUp(event: any) {
    pointers.current.delete(event.pointerId);
    if (event.pointerType === "mouse" || pointers.current.size === 0) {
      pointers.current.clear();
      gesture.current = null;
      return;
    }
    if (pointers.current.size === 1) {
      const remaining = [...pointers.current.values()][0];
      gesture.current = { mode: "pan", x: remaining.x, y: remaining.y, panX: panRef.current.x, panY: panRef.current.y, distance: 0, zoom };
    } else gesture.current = null;
  }
  function handleCanvasPointerLeave(event: any) {
    if (event.pointerType === "mouse") {
      pointers.current.clear();
      gesture.current = null;
    }
  }

  function moveNode(id: string, x: number, y: number) {
    setNodes((current) => current.map((n) => n.id === id ? { ...n, x: Math.max(GRID, Math.min(canvasWidth - n.w - GRID, x)), y: Math.max(GRID, Math.min(CANVAS_H - n.h - GRID, y)) } : n));
  }
  function dropNode(id: string, x: number, y: number) { moveNode(id, snap(x), snap(y)); }

  function resizeNode(id: string, w: number, h: number) {
    setNodes((current) => current.map((n) => n.id === id ? { ...n, w: Math.min(canvasWidth - n.x - GRID, w), h: Math.min(CANVAS_H - n.y - GRID, h) } : n));
  }

  function deleteNode(id: string) {
    saveUndo();
    setNodes((current) => current.filter((n) => n.id !== id));
    setEdges((current) => current.filter((e) => e.from !== id && e.to !== id));
    if (selectedNode === id) setSelectedNode(null);
  }

  function setNodeLabel(id: string, label: string) {
    setNodes((current) => current.map((n) => n.id === id ? { ...n, label } : n));
  }

  function tapNode(id: string) {
    if (!connectMode) { setSelectedNode(id); return; }
    if (!connectFrom) { setConnectFrom(id); setSelectedNode(id); return; }
    if (connectFrom === id) { setConnectFrom(null); return; }
    const source = nodeMap.get(connectFrom), target = nodeMap.get(id);
    if (!source || !target) { setConnectFrom(null); return; }
    const dx = target.x + target.w / 2 - (source.x + source.w / 2);
    const dy = target.y + target.h / 2 - (source.y + source.h / 2);
    const fromSide: FlowPort = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
    const toSide: FlowPort = fromSide === "left" ? "right" : fromSide === "right" ? "left" : fromSide === "top" ? "bottom" : "top";
    saveUndo();
    const edgeId = `${connectFrom}-${id}-${Date.now().toString(36)}`;
    setEdges((current) => [...current, { id: edgeId, from: connectFrom, to: id, fromSide, toSide, label: "", line: newLine, arrow: newArrow }]);
    setConnectFrom(null); setConnectMode(false); setSelectedNode(id);
  }

  function canvasWorldPoint(pageX: number, pageY: number, callback: (x: number, y: number) => void) {
    canvasRef.current?.measureInWindow((x, y) => callback((pageX - x) / zoom, (pageY - y) / zoom));
  }

  function startConnection(id: string, sideName: FlowPort) {
    const node = nodeMap.get(id);
    if (!node) return;
    const point = portPoint(node, sideName);
    setSelectedNode(id);
    setConnectionDrag({ from: id, side: sideName, x: point.x, y: point.y });
  }

  function moveConnection(pageX: number, pageY: number) {
    canvasWorldPoint(pageX, pageY, (x, y) => setConnectionDrag((current) => current ? { ...current, x, y } : null));
  }

  function finishConnection(pageX: number, pageY: number) {
    const active = connectionDrag;
    setConnectionDrag(null);
    if (!active) return;
    canvasWorldPoint(pageX, pageY, (x, y) => {
      let nearest: { node: FlowNode; side: FlowPort; distance: number } | null = null;
      for (const node of nodes) {
        if (node.id === active.from) continue;
        for (const sideName of ["top", "right", "bottom", "left"] as FlowPort[]) {
          const point = portPoint(node, sideName);
          const distance = Math.hypot(point.x - x, point.y - y);
          if (!nearest || distance < nearest.distance) nearest = { node, side: sideName, distance };
        }
      }
      if (!nearest || nearest.distance > Math.max(30, 42 / zoom)) return;
      saveUndo();
      const target = nearest as { node: FlowNode; side: FlowPort; distance: number };
      const edgeId = `${active.from}-${target.node.id}-${Date.now().toString(36)}`;
      setEdges((current) => [...current, { id: edgeId, from: active.from, to: target.node.id, fromSide: active.side, toSide: target.side, label: "", line: newLine, arrow: newArrow }]);
    });
  }
  function arrange() {
    saveUndo();
    setNodes((current) => current.map((n, i) => ({ ...n, x: snap((canvasWidth - n.w) / 2), y: Math.min(CANVAS_H - n.h - GRID, snap(48 + i * 112)) })));
  }

  const gridLines = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let x = 0; x <= canvasWidth; x += GRID) out.push(<Path key={`x${x}`} d={`M${x} 0V${CANVAS_H}`} stroke={x % (GRID * 4) === 0 ? "#d9e2f0" : "#edf1f7"} strokeWidth={x % (GRID * 4) === 0 ? 1 : 0.7} />);
    for (let y = 0; y <= CANVAS_H; y += GRID) out.push(<Path key={`y${y}`} d={`M0 ${y}H${canvasWidth}`} stroke={y % (GRID * 4) === 0 ? "#d9e2f0" : "#edf1f7"} strokeWidth={y % (GRID * 4) === 0 ? 1 : 0.7} />);
    return out;
  }, [canvasWidth]);
  const viewportGridLines = useMemo(() => {
    const out = [];
    const step = GRID * zoom;
    const width = viewportSize.width || screenWidth;
    const height = viewportSize.height || screenHeight;
    const startX = ((pan.x % step) + step) % step;
    const startY = ((pan.y % step) + step) % step;
    for (let x = startX; x <= width; x += step) out.push(<View key={`vx${x}`} style={{ position: "absolute", left: x, top: 0, width: 1, height, backgroundColor: "#e5eaf2" }} />);
    for (let y = startY; y <= height; y += step) out.push(<View key={`vy${y}`} style={{ position: "absolute", left: 0, top: y, width, height: 1, backgroundColor: "#e5eaf2" }} />);
    return out;
  }, [screenWidth, screenHeight, viewportSize.width, viewportSize.height, zoom, pan.x, pan.y]);

  return <Modal visible animationType="slide" onRequestClose={onBack}>
    <View style={styles.fullscreen}>
      <View style={styles.fullHeader}>
        <Pressable onPress={onBack} style={styles.backButton}><Ionicons name="arrow-back" size={20} color="#45526b" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.kicker}>FLOWCHART PRACTICE</Text><Text style={styles.fullTitle}>ฝึกวาดผังภาพ</Text></View>
        <Pressable onPress={onBack} style={styles.changeMode}><Text style={styles.changeModeText}>เปลี่ยนรูปแบบ</Text></Pressable>
      </View>
      <View style={styles.questionCard}><Text style={styles.questionLabel}>โจทย์จากวิชา</Text><Text style={styles.questionText}>{question}</Text></View>
      <View style={styles.builder}>
    <View style={styles.workspaceRow}>
      <ScrollView style={[styles.sidePanel, { width: sideWidth }]} showsVerticalScrollIndicator>
    <View style={styles.editorHeading}>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>FLOWCHART WORKSPACE</Text>
        <Text style={styles.editorTitle}>วางผังงานของคุณ</Text>
        <Text style={styles.editorSub}>แตะเลือก · ลากจุดเขียวเพื่อเชื่อม</Text>
      </View>
    </View>

    <View style={styles.symbolMenuWrap}>
      <Pressable onPress={() => setSymbolMenu((open) => !open)} style={styles.symbolMenuButton}>
        <Ionicons name="shapes-outline" size={17} color="#5b45c5" />
        <Text style={styles.symbolMenuTitle}>สัญลักษณ์ผังงาน · 28 แบบ</Text>
        <Text style={styles.symbolMenuHint}>{symbolMenu ? "ซ่อน" : "เลือกสัญลักษณ์"}</Text>
        <Ionicons name={symbolMenu ? "chevron-up" : "chevron-down"} size={16} color="#7467c4" />
      </Pressable>
      {symbolMenu ? <View style={styles.symbolGridScroll}>
        {SHAPES.map((item) => <PaletteItem key={item.kind} item={item} onAdd={addNode} onDrop={dropPalette} />)}
      </View> : null}
    </View>

    <Text style={styles.paletteHint}>เลือกเพื่อวาง · แตะในรูปทรงเพื่อพิมพ์ · จุดเขียวใช้ลากเชื่อม</Text>
      </ScrollView>

      <WheelView
        style={styles.canvasPanel}
        onWheel={(event: any) => { if (event.ctrlKey || event.metaKey) { event.preventDefault?.(); changeZoom(zoom * (event.deltaY < 0 ? 1.08 : 0.92)); } }}
      >
        <View style={styles.canvasToolbar}>
          <View style={{ flex: 1 }}><Text style={styles.canvasToolbarTitle}>พื้นที่วางผังงาน</Text><Text style={styles.canvasToolbarHint}>ลากพื้นที่ว่างเพื่อเลื่อน · หนีบสองนิ้วเพื่อซูม</Text></View>
          <Pressable disabled={!undoStack.length} onPress={undo} style={[styles.canvasToolButton, !undoStack.length && styles.toolDisabled]}><Ionicons name="arrow-undo" size={14} color="#5b45c5" /><Text style={styles.canvasToolText}>ย้อนกลับ</Text></Pressable>
          <Pressable disabled={!redoStack.length} onPress={redo} style={[styles.canvasToolButton, !redoStack.length && styles.toolDisabled]}><Ionicons name="arrow-redo" size={14} color="#5b45c5" /><Text style={styles.canvasToolText}>ไปข้างหน้า</Text></Pressable>
          <Pressable onPress={arrange} style={styles.canvasToolButton}><Ionicons name="git-compare-outline" size={15} color="#5b45c5" /><Text style={styles.canvasToolText}>จัดเรียง</Text></Pressable>
          <Pressable onPress={() => setConnectionMenu((v) => !v)} style={[styles.canvasToolButton, connectionMenu && styles.lineChoiceOn]}><Ionicons name="git-network-outline" size={14} color="#5b45c5" /><Text style={styles.canvasToolText}>ตั้งค่าเส้น</Text></Pressable>
          <Pressable onPress={() => changeZoom(zoom - 0.1)} style={styles.zoomButton}><Ionicons name="remove" size={19} color="#4f5b73" /></Pressable>
          <Pressable onPress={resetView} style={styles.zoomReadout}><Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text></Pressable>
          <Pressable onPress={() => changeZoom(zoom + 0.1)} style={styles.zoomButton}><Ionicons name="add" size={19} color="#4f5b73" /></Pressable>
          <Pressable onPress={() => changeZoom(1)} style={styles.canvasToolButton}><Text style={styles.canvasToolText}>100%</Text></Pressable>
        </View>
        {connectionMenu ? <View style={styles.connectionSettings}>
          <Pressable onPress={() => { setConnectMode((current) => !current); setConnectFrom(null); }} style={[styles.manualConnectButton, connectMode && styles.toolButtonOn]}><Ionicons name="hand-left-outline" size={13} color={connectMode ? "#fff" : "#5b45c5"} /><Text style={[styles.canvasToolText, connectMode && { color: "#fff" }]}>{connectMode ? connectFrom ? "เลือกปลายทาง…" : "เลือกต้นทาง…" : "เชื่อมโดยแตะเลือกสองรูปทรง"}</Text></Pressable>
          <Text style={styles.connectionSettingsLabel}>รูปแบบเส้น</Text>
          {(["straight", "elbow", "curved"] as LineKind[]).map((kind) => <Pressable key={kind} onPress={() => setNewLine(kind)} style={[styles.lineChoice, newLine === kind && styles.lineChoiceOn]}><Text style={styles.lineChoiceText}>{kind === "straight" ? "ตรง" : kind === "elbow" ? "มุมฉาก" : "โค้ง"}</Text></Pressable>)}
          <View style={styles.connectionSettingsDivider} />
          <Text style={styles.connectionSettingsLabel}>หัวเส้น</Text>
          {(["forward", "none", "both"] as ArrowKind[]).map((kind) => <Pressable key={kind} onPress={() => setNewArrow(kind)} style={[styles.arrowChoice, newArrow === kind && styles.lineChoiceOn]}><Text style={styles.arrowChoiceText}>{kind === "forward" ? "→" : kind === "none" ? "—" : "↔"}</Text></Pressable>)}
          <Pressable onPress={() => { saveUndo(); setNodes([]); setEdges([]); setSelectedNode(null); }} style={styles.clearButton}><Ionicons name="refresh-outline" size={14} color="#68758c" /><Text style={styles.clearText}>เริ่มใหม่</Text></Pressable>
        </View> : null}

    <WheelView
      testID="flowchart-viewport"
      style={[styles.canvasArea, { touchAction: "none" } as any]}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerUp}
      onPointerLeave={handleCanvasPointerLeave}
      onLayout={(event: any) => setViewportSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
    >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {viewportGridLines}
        </View>
        <View ref={canvasRef} style={[styles.canvas, { width: canvasWidth * zoom, height: CANVAS_H * zoom, left: pan.x, top: pan.y }]}>
          <Svg style={StyleSheet.absoluteFill} width={canvasWidth * zoom} height={CANVAS_H * zoom} viewBox={`0 0 ${canvasWidth} ${CANVAS_H}`} pointerEvents="none">
            <Rect width={canvasWidth} height={CANVAS_H} fill="#fbfcff" />
            {gridLines}
            <Rect x={1} y={1} width={canvasWidth - 2} height={CANVAS_H - 2} fill="none" stroke="#9baac2" strokeWidth={2} />
            <Defs>
              <Marker id="flowArrow" markerWidth={9} markerHeight={9} refX={8} refY={3} orient="auto" markerUnits="strokeWidth"><Path d="M0,0 L0,6 L8,3 z" fill="#6b7890" /></Marker>
              <Marker id="flowStartArrow" markerWidth={9} markerHeight={9} refX={1} refY={3} orient="auto-start-reverse" markerUnits="strokeWidth"><Path d="M8,0 L8,6 L0,3 z" fill="#6b7890" /></Marker>
            </Defs>
            {edges.map((edge) => {
              const a = nodeMap.get(edge.from), b = nodeMap.get(edge.to);
              if (!a || !b) return null;
              return <Path
                key={edge.id}
                d={edgePath(a, b, edge.line, edge.fromSide, edge.toSide)}
                fill="none"
                stroke="#6b7890"
                strokeWidth={2}
                markerEnd={edge.arrow === "none" ? undefined : "url(#flowArrow)"}
                markerStart={edge.arrow === "both" ? "url(#flowStartArrow)" : undefined}
              />;
            })}
            {connectionDrag ? (() => {
              const source = nodeMap.get(connectionDrag.from);
              if (!source) return null;
              const start = portPoint(source, connectionDrag.side);
              return <Path d={`M${start.x} ${start.y} L${connectionDrag.x} ${connectionDrag.y}`} fill="none" stroke="#22c55e" strokeWidth={2.5} strokeDasharray="6 4" />;
            })() : null}
          </Svg>
          {nodes.map((node) => <DraggableNode
            key={node.id} node={node} selected={selectedNode === node.id} scale={zoom} connectMode={connectMode}
            onSelect={setSelectedNode} onTap={tapNode} onMove={moveNode} onDrop={dropNode} onMoveStart={saveUndo}
            onResize={resizeNode} onResizeStart={saveUndo} onDelete={deleteNode}
            onLabelChange={setNodeLabel} onEditStart={saveUndo}
            onConnectStart={startConnection} onConnectMove={moveConnection} onConnectEnd={finishConnection}
          />)}
        </View>
        {nodes.length === 0 ? <View pointerEvents="none" style={styles.emptyCanvas}>
          <View style={styles.emptyIcon}><Ionicons name="git-branch-outline" size={22} color="#8b7bf0" /></View>
          <Text style={styles.emptyTitle}>เริ่มวางผังงาน</Text>
          <Text style={styles.emptyText}>ลากรูปทรงจากแถบด้านข้างมาวางที่นี่</Text>
        </View> : null}
    </WheelView>

    <Text style={styles.canvasHint}>{connectionDrag ? "ลากจุดสีเขียวไปปล่อยบนจุดของรูปทรงปลายทาง" : connectMode ? (connectFrom ? "แตะรูปทรงปลายทางเพื่อเชื่อม" : "แตะรูปทรงต้นทางก่อน แล้วเลือกรูปทรงปลายทาง") : "ลากพื้นที่ว่างเพื่อเลื่อนผัง · ใช้จุดสีเขียวเชื่อมเส้น · แตะในรูปทรงเพื่อแก้ข้อความ"}</Text>
      </WheelView>
    </View>
    </View>
      {feedback ? <View style={styles.feedback}><Ionicons name="chatbox-ellipses-outline" size={16} color="#5b45c5" /><Text style={styles.feedbackText}>{feedback}</Text></View> : null}
      <View style={styles.footerActions}>
        <Pressable onPress={onCheck} disabled={busy} style={[styles.checkButton, busy && { opacity: 0.55 }]}>
          <Ionicons name="checkmark-done-outline" size={17} color="#fff" /><Text style={styles.checkButtonText}>{busy ? "กำลังตรวจ..." : "ตรวจคำตอบ"}</Text>
        </Pressable>
        <Pressable onPress={onNext} disabled={busy} style={[styles.nextButton, busy && { opacity: 0.55 }]}>
          <Ionicons name="arrow-forward-outline" size={17} color="#5b45c5" /><Text style={styles.nextButtonText}>โจทย์ถัดไป</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1, backgroundColor: "#f8f9fc", paddingTop: 8, paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  fullHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 9 },
  backButton: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#e1e6ef" },
  fullTitle: { color: "#202b42", fontSize: 16, fontWeight: "900" },
  changeMode: { paddingHorizontal: 10, height: 34, borderRadius: 10, justifyContent: "center", backgroundColor: "#f0edff" },
  changeModeText: { color: "#6552ca", fontSize: 11, fontWeight: "800" },
  questionCard: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 13, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e1e6ef", maxHeight: 85 },
  questionLabel: { color: "#8a94a8", fontSize: 10, fontWeight: "800", marginBottom: 3 },
  questionText: { color: "#26334a", fontSize: 13, fontWeight: "700", lineHeight: 19 },
  builder: { flex: 1, minHeight: 0, gap: 8, padding: 8, borderRadius: 18, backgroundColor: "#f5f7ff", borderWidth: 1, borderColor: "#dfe5f2" },
  workspaceRow: { flex: 1, minHeight: 0, flexDirection: "row", gap: 8 },
  sidePanel: { flexGrow: 0, flexShrink: 0, minHeight: 0, padding: 8, borderRadius: 14, borderWidth: 1, borderColor: "#e0e5f1", backgroundColor: "#fff" },
  canvasPanel: { flex: 1, minWidth: 0, minHeight: 0, padding: 8, borderRadius: 14, borderWidth: 1, borderColor: "#e0e5f1", backgroundColor: "#fff", gap: 7 },
  editorHeading: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#edf0f6" },
  kicker: { color: "#7c6dea", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  editorTitle: { color: "#1f2a43", fontSize: 17, fontWeight: "900", marginTop: 2 },
  editorSub: { color: "#71809a", fontSize: 12, marginTop: 3 },
  symbolMenuWrap: { borderWidth: 1, borderColor: "#e0e5f1", borderRadius: 12, backgroundColor: "#fff", overflow: "hidden", marginTop: 8 },
  symbolMenuButton: { minHeight: 38, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#fff" },
  symbolMenuTitle: { color: "#39445b", fontSize: 11, fontWeight: "900", flex: 1 },
  symbolMenuHint: { color: "#7467c4", fontSize: 10, fontWeight: "700" },
  symbolGridScroll: { borderTopWidth: 1, borderTopColor: "#edf0f6", padding: 5, gap: 4 },
  symbolGrid: { padding: 6, flexDirection: "column", gap: 5 },
  paletteItem: { width: "100%", minHeight: 34, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 7, borderWidth: 1, borderColor: "#e5e8f1", backgroundColor: "#fbfcff", flexDirection: "row", alignItems: "center", gap: 4 },
  paletteText: { color: "#39445b", fontSize: 8, lineHeight: 10, fontWeight: "800", flex: 1 },
  paletteHint: { color: "#8a94a8", fontSize: 9, lineHeight: 13, paddingTop: 8 },
  sideSection: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#edf0f6", gap: 6 },
  sideSectionTitle: { color: "#596780", fontSize: 11, fontWeight: "900" },
  sideChoices: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 },
  canvasToolbar: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 2 },
  canvasToolbarTitle: { color: "#26334a", fontSize: 13, fontWeight: "900" },
  canvasToolbarHint: { color: "#8792a6", fontSize: 9, marginTop: 2 },
  canvasToolButton: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 7, borderRadius: 8, borderWidth: 1, borderColor: "#e0e5ef", backgroundColor: "#fff" },
  toolDisabled: { opacity: 0.38 },
  canvasToolText: { color: "#5b45c5", fontSize: 9, fontWeight: "800" },
  zoomButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "#e0e5ef", backgroundColor: "#fff" },
  zoomReadout: { minWidth: 42, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#f2efff" },
  zoomText: { color: "#5b45c5", fontSize: 9, fontWeight: "900" },
  connectionSettings: { minHeight: 36, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 9, backgroundColor: "#f6f7fb", borderWidth: 1, borderColor: "#e6e9f2" },
  connectionSettingsLabel: { color: "#7b859b", fontSize: 9, fontWeight: "800" },
  connectionSettingsDivider: { width: 1, height: 20, backgroundColor: "#dfe4ee", marginHorizontal: 3 },
  manualConnectButton: { minHeight: 29, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd8f8" },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 },
  toolbarSecondary: { flexDirection: "row", alignItems: "center", gap: 5 },
  toolButton: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "#ddd8f8", backgroundColor: "#fff" },
  toolButtonOn: { backgroundColor: "#6d5ce7", borderColor: "#6d5ce7" },
  toolLabel: { color: "#5b45c5", fontSize: 11, fontWeight: "800" },
  divider: { width: 1, height: 24, backgroundColor: "#dfe4ee", marginHorizontal: 4 },
  lineChoice: { minHeight: 32, paddingHorizontal: 9, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e0e5ef" },
  lineChoiceOn: { borderColor: "#9688ef", backgroundColor: "#f2efff" },
  lineChoiceText: { color: "#68758c", fontSize: 10, fontWeight: "800" },
  smallLabel: { color: "#8792a6", fontSize: 10, fontWeight: "800", marginRight: 3 },
  arrowChoice: { width: 34, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "#e0e5ef", backgroundColor: "#fff" },
  arrowChoiceText: { color: "#68758c", fontSize: 17, fontWeight: "800" },
  deleteButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, height: 30, borderRadius: 8, backgroundColor: "#fff4f5" },
  deleteText: { color: "#c64b60", fontSize: 10, fontWeight: "800" },
  clearButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, height: 30, borderRadius: 8, backgroundColor: "#fff" },
  clearText: { color: "#68758c", fontSize: 10, fontWeight: "800" },
  canvasArea: { flex: 1, minHeight: 200, borderRadius: 10, overflow: "hidden", backgroundColor: "#fbfcff", borderWidth: 1, borderColor: "#aab6ca", position: "relative", cursor: "grab" as any, userSelect: "none" as any },
  canvasOuter: { flexGrow: 1, paddingVertical: 2 },
  canvasScroll: { flex: 1, minHeight: 200, borderRadius: 10, backgroundColor: "#fbfcff" },
  canvas: { overflow: "hidden", position: "relative" },
  nodeWrap: { position: "absolute", alignItems: "center", justifyContent: "center", zIndex: 2 },
  nodeInput: { position: "absolute", textAlign: "center", textAlignVertical: "center", color: "#26334a", fontWeight: "800", backgroundColor: "transparent", borderWidth: 0, paddingHorizontal: 2, paddingVertical: 0, includeFontPadding: false, overflow: "hidden" },
  connectionPort: { position: "absolute", backgroundColor: "#22c55e", borderWidth: 2.5, borderColor: "#fff", borderRadius: 99, zIndex: 4, cursor: "crosshair" as any },
  port_top: { top: -6, left: "50%" },
  port_right: { right: -6, top: "50%" },
  port_bottom: { bottom: -6, left: "50%" },
  port_left: { left: -6, top: "50%" },
  nodeDelete: { position: "absolute", top: -15, right: -15, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#ef476f", borderWidth: 2, borderColor: "#fff", zIndex: 6, cursor: "pointer" as any },
  resizeHandle: { position: "absolute", right: -12, bottom: -12, width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#6d5ce7", borderWidth: 2, borderColor: "#fff", zIndex: 5 },
  resizeDragTarget: { cursor: "nwse-resize" as any },
  emptyCanvas: { position: "absolute", left: 0, right: 0, top: "45%", alignItems: "center", gap: 7 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#f0edff", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#44516a", fontSize: 14, fontWeight: "900" },
  emptyText: { color: "#8792a6", fontSize: 11, textAlign: "center", paddingHorizontal: 18 },
  canvasHint: { color: "#71809a", fontSize: 10, marginTop: -3 },
  feedback: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#f0edff" },
  feedbackText: { color: "#4b3da2", fontSize: 11, fontWeight: "700", flex: 1 },
  footerActions: { flexDirection: "row", gap: 8 },
  checkButton: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 13, backgroundColor: "#6d35d9" },
  checkButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  nextButton: { width: 150, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 13, backgroundColor: "#fff", borderWidth: 1, borderColor: "#dcd6f7" },
  nextButtonText: { color: "#5b45c5", fontSize: 12, fontWeight: "800" },
  inspector: { padding: 10, borderRadius: 13, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e1e6f0", gap: 7 },
  inspectorTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
  inspectorHeading: { color: "#47536c", fontSize: 11, fontWeight: "800" },
  labelInput: { minHeight: 40, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "#dfe5f0", color: "#28344a", backgroundColor: "#fbfcff" },
  edgeList: { gap: 6 },
  edgeChip: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, borderWidth: 1, borderColor: "#e0e5ef", backgroundColor: "#fff" },
  edgeChipOn: { borderColor: "#9688ef", backgroundColor: "#f2efff" },
  edgeChipText: { color: "#596780", fontSize: 10, fontWeight: "700" },
});
