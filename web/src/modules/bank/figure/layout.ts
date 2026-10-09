// แปลงข้อกำหนดรูป → ฉาก (scene) ในพิกัดจริง (หน่วยตามโจทย์, แกน y ชี้ขึ้น)
// ทุกรูปคำนวณพิกัดจากตัวเลขในข้อกำหนดโดยตรง จึงวาดตามสัดส่วนจริงเสมอ (SPEC §5.5)
// แต่ละรูปประกาศ "ข้อกำหนดที่ต้องเป็นจริง" (constraints) ไว้ให้ verifyScene ตรวจกับพิกัดที่วาดจริง
import type {
  AnglesSpec, BarChartSpec, CircleSpec, CuboidSpec, FigureSpec, Lbl, LineGraphSpec, NumberLineSpec,
  ParallelogramSpec, PieChartSpec, RectangleSpec, RectilinearSpec, RhombusSpec, SquareSpec, TableSpec,
  TrapezoidSpec, TriangleSpec,
} from './spec';
import { GEOMETRIC_KINDS } from './spec';

export interface P { x: number; y: number }

export type Prim =
  | { t: 'path'; pts: P[]; closed?: boolean; dashed?: boolean; fill?: string; width?: number; stroke?: string }
  | { t: 'circle'; c: P; r: number; dashed?: boolean }
  | { t: 'sector'; c: P; r: number; a1: number; a2: number; fill: string }
  | { t: 'arc'; c: P; a1: number; a2: number; r: number }               // r เป็นพิกเซล, มุมทวนเข็มจาก a1 ถึง a2
  | { t: 'right'; c: P; a1: number; a2: number; size: number }          // เครื่องหมายมุมฉาก
  | { t: 'tick'; a: P; b: P; count: number }                            // ขีดด้านเท่า
  | { t: 'dot'; at: P; r: number }
  | { t: 'text'; at: P; text: string; dx?: number; dy?: number; anchor?: 'start' | 'middle' | 'end';
      size?: number; bold?: boolean; muted?: boolean };

export type Constraint =
  | { kind: 'length'; a: P; b: P; value: number; what: string }
  | { kind: 'angle'; a: P; v: P; b: P; value: number; what: string };

export interface Scene {
  prims: Prim[];
  constraints: Constraint[];
  /** true = พิกัดเป็นพิกเซลอยู่แล้ว (แผนภูมิ/ตาราง) ไม่ต้องย่อขยาย */
  pixelSpace: boolean;
  geometric: boolean;
}

export class FigureError extends Error {}

// ---------- เครื่องมือ ----------
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const pt = (x: number, y: number): P => ({ x, y });
const add = (a: P, b: P): P => pt(a.x + b.x, a.y + b.y);
const sub = (a: P, b: P): P => pt(a.x - b.x, a.y - b.y);
const mul = (a: P, k: number): P => pt(a.x * k, a.y * k);
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: P, b: P) => pt((a.x + b.x) / 2, (a.y + b.y) / 2);
const dirDeg = (from: P, to: P) => norm360(deg(Math.atan2(to.y - from.y, to.x - from.x)));
export const norm360 = (d: number) => ((d % 360) + 360) % 360;

export function angleAt(a: P, v: P, b: P): number {
  const u = sub(a, v), w = sub(b, v);
  const c = (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y));
  return deg(Math.acos(Math.max(-1, Math.min(1, c))));
}

export function fmtNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  if (Number.isInteger(r)) return r.toLocaleString('en-US');
  return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function lblText(l: Lbl, value: number | undefined, unit: string | undefined, suffix = ''): string | null {
  if (l === undefined || l === false) return null;
  if (typeof l === 'string') return l;
  if (value === undefined) return null;
  return `${fmtNum(value)}${suffix}${unit ? ' ' + unit : ''}`;
}

function need(v: number | undefined, name: string): number {
  if (v === undefined || v === null || !Number.isFinite(v)) throw new FigureError(`ยังไม่ได้กำหนด ${name}`);
  return v;
}
function pos(v: number | undefined, name: string): number {
  const x = need(v, name);
  if (x <= 0) throw new FigureError(`${name} ต้องมากกว่า 0`);
  return x;
}
function angleIn(v: number | undefined, name: string): number {
  const x = need(v, name);
  if (x <= 0 || x >= 180) throw new FigureError(`มุม ${name} ต้องอยู่ระหว่าง 0° ถึง 180°`);
  return x;
}

/** ข้อความกำกับด้าน: วางนอกรูป ตั้งฉากกับด้าน ห่างจากด้าน gap พิกเซล */
function sideLabel(a: P, b: P, inside: P, text: string, gap = 14): Prim {
  const m = mid(a, b);
  const d = sub(b, a);
  let n = pt(-d.y, d.x);
  const len = Math.hypot(n.x, n.y) || 1;
  n = mul(n, 1 / len);
  if ((inside.x - m.x) * n.x + (inside.y - m.y) * n.y > 0) n = mul(n, -1);
  // ด้านแนวตั้ง/เฉียง: ชิดข้อความไว้ข้างเส้น ไม่ให้ข้อความทับเส้น
  const anchor = n.x > 0.35 ? 'start' : n.x < -0.35 ? 'end' : 'middle';
  const g = anchor === 'middle' ? gap : Math.min(gap, 10);
  return { t: 'text', at: m, text, dx: n.x * g, dy: -n.y * g, anchor };
}

/** ชื่อจุดยอด: วางห่างจากจุดศูนย์กลางรูปออกไป */
function vertexLabel(p: P, center: P, text: string, gap = 13): Prim {
  let d = sub(p, center);
  const len = Math.hypot(d.x, d.y) || 1;
  d = mul(d, 1 / len);
  return { t: 'text', at: p, text, dx: d.x * gap, dy: -d.y * gap, bold: true };
}

function centroid(ps: P[]): P {
  return mul(ps.reduce(add, pt(0, 0)), 1 / ps.length);
}

/** เครื่องหมายมุมที่จุด v ระหว่างทิศไป a และไป b (ด้านในรูป) พร้อมป้าย */
function angleMark(prims: Prim[], a: P, v: P, b: P, value: number, label: string | null, forceArc = false) {
  let a1 = dirDeg(v, a), a2 = dirDeg(v, b);
  if (norm360(a2 - a1) > 180) [a1, a2] = [a2, a1];
  if (!forceArc && Math.abs(value - 90) < 1e-6) {
    prims.push({ t: 'right', c: v, a1, a2, size: 11 });
    if (label && label !== '90°') pushAngleLabel(prims, v, a1, a2, label, 26);
    return;
  }
  if (!label && !forceArc) return;
  const r = value < 40 ? 26 : 18;
  prims.push({ t: 'arc', c: v, a1, a2, r });
  if (label) pushAngleLabel(prims, v, a1, a2, label, r + 13);
}

function pushAngleLabel(prims: Prim[], v: P, a1: number, a2: number, label: string, r: number) {
  const bis = rad(a1 + norm360(a2 - a1) / 2);
  prims.push({ t: 'text', at: v, text: label, dx: Math.cos(bis) * r, dy: -Math.sin(bis) * r, size: 13 });
}

function ticks(prims: Prim[], a: P, b: P, count: number) {
  prims.push({ t: 'tick', a, b, count });
}

// ---------- ตัวสร้างแต่ละชนิด ----------
function triangle(s: TriangleSpec): Scene {
  const names = s.names ?? ['A', 'B', 'C'];
  const show = s.show ?? {};
  let ab: number, bc: number, ca: number, B: number;
  if (s.mode === 'SSS') {
    ab = pos(s.ab, 'ด้าน AB'); bc = pos(s.bc, 'ด้าน BC'); ca = pos(s.ca, 'ด้าน CA');
    const sides = [ab, bc, ca].sort((x, y) => x - y);
    if (sides[0] + sides[1] <= sides[2] * (1 + 1e-12))
      throw new FigureError('ความยาวด้านสร้างสามเหลี่ยมไม่ได้ (ผลบวกสองด้านต้องมากกว่าด้านที่สาม)');
    B = deg(Math.acos((ab * ab + bc * bc - ca * ca) / (2 * ab * bc)));
  } else if (s.mode === 'SAS') {
    ab = pos(s.ab, 'ด้าน AB'); bc = pos(s.bc, 'ด้าน BC'); B = angleIn(s.B, 'B');
    ca = Math.sqrt(ab * ab + bc * bc - 2 * ab * bc * Math.cos(rad(B)));
  } else if (s.mode === 'ASA') {
    const A = angleIn(s.A, 'A'); B = angleIn(s.B, 'B'); ab = pos(s.ab, 'ด้าน AB');
    if (A + B >= 180) throw new FigureError('มุม A + มุม B ต้องน้อยกว่า 180°');
    const C = 180 - A - B;
    bc = (ab * Math.sin(rad(A))) / Math.sin(rad(C));
    ca = (ab * Math.sin(rad(B))) / Math.sin(rad(C));
  } else throw new FigureError('รูปแบบการกำหนดสามเหลี่ยมไม่ถูกต้อง');

  const Bp = pt(0, 0), Cp = pt(bc, 0), Ap = pt(ab * Math.cos(rad(B)), ab * Math.sin(rad(B)));
  const A = angleAt(Bp, Ap, Cp), C = angleAt(Ap, Cp, Bp);
  const ctr = centroid([Ap, Bp, Cp]);
  const prims: Prim[] = [{ t: 'path', pts: [Ap, Bp, Cp], closed: true }];
  const sideVal = { ab, bc, ca };
  const sideP: Record<string, [P, P]> = { ab: [Ap, Bp], bc: [Bp, Cp], ca: [Cp, Ap] };
  for (const k of ['ab', 'bc', 'ca'] as const) {
    const t = lblText(show[k], sideVal[k], s.unit);
    if (t) prims.push(sideLabel(sideP[k][0], sideP[k][1], ctr, t));
  }
  const angs: Array<[keyof NonNullable<TriangleSpec['show']>, P, P, P, number]> = [
    ['A', Bp, Ap, Cp, A], ['B', Ap, Bp, Cp, B], ['C', Ap, Cp, Bp, C]];
  for (const [k, a, v, b, val] of angs) angleMark(prims, a, v, b, val, lblText(show[k], val, undefined, '°'));
  (s.equalSides ?? []).forEach((grp, gi) => {
    const vals = grp.map((k) => {
      if (!(k in sideVal)) throw new FigureError(`ไม่รู้จักด้าน "${k}" (ใช้ ab, bc, ca)`);
      return sideVal[k as keyof typeof sideVal];
    });
    if (vals.some((v) => Math.abs(v - vals[0]) > 1e-9 * Math.max(1, vals[0])))
      throw new FigureError(`ด้าน ${grp.join(', ')} ถูกทำเครื่องหมายว่ายาวเท่ากัน แต่ตัวเลขไม่เท่ากัน`);
    grp.forEach((k) => ticks(prims, sideP[k][0], sideP[k][1], gi + 1));
  });
  [Ap, Bp, Cp].forEach((p, i) => prims.push(vertexLabel(p, ctr, names[i])));
  return {
    prims, pixelSpace: false, geometric: true,
    constraints: [
      { kind: 'length', a: Ap, b: Bp, value: ab, what: 'ด้าน AB' },
      { kind: 'length', a: Bp, b: Cp, value: bc, what: 'ด้าน BC' },
      { kind: 'length', a: Cp, b: Ap, value: ca, what: 'ด้าน CA' },
      { kind: 'angle', a: Ap, v: Bp, b: Cp, value: B, what: 'มุม B' },
      ...(s.mode === 'ASA' ? [{ kind: 'angle' as const, a: Bp, v: Ap, b: Cp, value: s.A!, what: 'มุม A' }] : []),
    ],
  };
}

function quad(names: string[] | undefined, ps: P[]): { prims: Prim[]; ctr: P } {
  const n = names ?? ['A', 'B', 'C', 'D'];
  const ctr = centroid(ps);
  const prims: Prim[] = [{ t: 'path', pts: ps, closed: true }];
  ps.forEach((p, i) => { if (n[i]) prims.push(vertexLabel(p, ctr, n[i])); });
  return { prims, ctr };
}

function rectangle(s: RectangleSpec): Scene {
  const w = pos(s.w, 'ความกว้าง'), h = pos(s.h, 'ความยาว/สูง');
  const [A, B, C, D] = [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)];
  const { prims, ctr } = quad(s.names, [A, B, C, D]);
  [[D, A, B], [A, B, C], [B, C, D], [C, D, A]].forEach(([a, v, b]) => angleMark(prims, a, v, b, 90, null));
  const tw = lblText(s.show?.w, w, s.unit), th = lblText(s.show?.h, h, s.unit);
  if (tw) prims.push(sideLabel(A, B, ctr, tw, 26));
  if (th) prims.push(sideLabel(B, C, ctr, th, 18));
  if (s.diagonal) prims.push({ t: 'path', pts: [A, C] });
  return { prims, pixelSpace: false, geometric: true, constraints: [
    { kind: 'length', a: A, b: B, value: w, what: 'ความกว้าง' },
    { kind: 'length', a: B, b: C, value: h, what: 'ความยาว' },
    { kind: 'angle', a: D, v: A, b: B, value: 90, what: 'มุมฉาก' },
  ] };
}

function square(s: SquareSpec): Scene {
  const a = pos(s.s, 'ความยาวด้าน');
  const [A, B, C, D] = [pt(0, 0), pt(a, 0), pt(a, a), pt(0, a)];
  const { prims, ctr } = quad(s.names, [A, B, C, D]);
  [[D, A, B], [A, B, C], [B, C, D], [C, D, A]].forEach(([p, v, q]) => angleMark(prims, p, v, q, 90, null));
  [[A, B], [B, C], [C, D], [D, A]].forEach(([p, q]) => ticks(prims, p, q, 1));
  const t = lblText(s.show?.s, a, s.unit);
  if (t) prims.push(sideLabel(A, B, ctr, t, 26));
  return { prims, pixelSpace: false, geometric: true, constraints: [
    { kind: 'length', a: A, b: B, value: a, what: 'ด้าน' },
    { kind: 'length', a: B, b: C, value: a, what: 'ด้าน' },
    { kind: 'angle', a: D, v: A, b: B, value: 90, what: 'มุมฉาก' },
  ] };
}

function parallelogramLike(base: number, side: number, angle: number, names: string[] | undefined,
                           show: { base?: Lbl; side?: Lbl; angle?: Lbl; height?: Lbl }, unit: string | undefined,
                           equal: boolean): Scene {
  const A = pt(0, 0), B = pt(base, 0);
  const off = pt(side * Math.cos(rad(angle)), side * Math.sin(rad(angle)));
  const D = add(A, off), C = add(B, off);
  const { prims, ctr } = quad(names, [A, B, C, D]);
  const tb = lblText(show.base, base, unit), ts = lblText(show.side, side, unit);
  if (tb) prims.push(sideLabel(A, B, ctr, tb));
  if (ts) prims.push(sideLabel(D, A, ctr, ts));
  angleMark(prims, D, A, B, angle, lblText(show.angle, angle, undefined, '°'));
  const h = side * Math.sin(rad(angle));
  const th = lblText(show.height, h, unit);
  if (th !== null) {
    const foot = pt(D.x, 0);
    prims.push({ t: 'path', pts: [D, foot], dashed: true });
    if (foot.x < 0 || foot.x > base) prims.push({ t: 'path', pts: [foot, foot.x < 0 ? A : B], dashed: true });
    angleMark(prims, D, foot, foot.x <= base / 2 ? B : A, 90, null);
    prims.push({ t: 'text', at: mid(D, foot), text: th, dx: 6, dy: 0, anchor: 'start' });
  }
  if (equal) [[A, B], [B, C], [C, D], [D, A]].forEach(([p, q]) => ticks(prims, p, q, 1));
  return { prims, pixelSpace: false, geometric: true, constraints: [
    { kind: 'length', a: A, b: B, value: base, what: 'ฐาน' },
    { kind: 'length', a: A, b: D, value: side, what: 'ด้านข้าง' },
    { kind: 'length', a: B, b: C, value: side, what: 'ด้านขนาน' },
    { kind: 'angle', a: D, v: A, b: B, value: angle, what: 'มุม' },
  ] };
}

function parallelogram(s: ParallelogramSpec): Scene {
  return parallelogramLike(pos(s.base, 'ฐาน'), pos(s.side, 'ด้านข้าง'), angleIn(s.angle, 'มุม'),
    s.names, s.show ?? {}, s.unit, false);
}
function rhombus(s: RhombusSpec): Scene {
  const a = pos(s.side, 'ความยาวด้าน');
  return parallelogramLike(a, a, angleIn(s.angle, 'มุม'), s.names,
    { base: s.show?.side, angle: s.show?.angle }, s.unit, true);
}

function trapezoid(s: TrapezoidSpec): Scene {
  const b = pos(s.bottom, 'ด้านล่าง'), t = pos(s.top, 'ด้านบน'), h = pos(s.height, 'ความสูง');
  const off = need(s.offset, 'ระยะเลื่อนด้านบน');
  const A = pt(0, 0), B = pt(b, 0), D = pt(off, h), C = pt(off + t, h);
  const { prims, ctr } = quad(s.names, [A, B, C, D]);
  const show = s.show ?? {};
  const tb = lblText(show.bottom, b, s.unit), tt = lblText(show.top, t, s.unit), th = lblText(show.height, h, s.unit);
  if (tb) prims.push(sideLabel(A, B, ctr, tb));
  if (tt) prims.push(sideLabel(D, C, ctr, tt));
  const rightLeft = Math.abs(off) < 1e-9, rightRight = Math.abs(off + t - b) < 1e-9;
  if (rightLeft) { angleMark(prims, D, A, B, 90, null); angleMark(prims, A, D, C, 90, null); }
  if (rightRight) { angleMark(prims, A, B, C, 90, null); angleMark(prims, B, C, D, 90, null); }
  if (th !== null) {
    if (rightLeft) prims.push(sideLabel(A, D, ctr, th, 16));
    else if (rightRight) prims.push(sideLabel(B, C, ctr, th, 16));
    else {
      // เส้นสูงลากในช่วงที่ด้านบนและด้านล่างซ้อนกัน (ถ้าไม่ซ้อน ลากจาก D แล้วต่อฐานด้วยเส้นประ)
      const lo = Math.max(off, 0), hi = Math.min(off + t, b);
      const x = hi - lo > 1e-9 ? lo + (hi - lo) * 0.25 : off;
      const P1 = pt(x, h), P2 = pt(x, 0);
      prims.push({ t: 'path', pts: [P1, P2], dashed: true });
      if (x < 0 || x > b) prims.push({ t: 'path', pts: [P2, x < 0 ? A : B], dashed: true });
      angleMark(prims, P1, P2, x < b / 2 ? B : A, 90, null);
      prims.push({ t: 'text', at: mid(P1, P2), text: th, dx: 6, anchor: 'start' });
    }
  }
  return { prims, pixelSpace: false, geometric: true, constraints: [
    { kind: 'length', a: A, b: B, value: b, what: 'ด้านล่าง' },
    { kind: 'length', a: D, b: C, value: t, what: 'ด้านบน' },
    { kind: 'length', a: pt(D.x, 0), b: D, value: h, what: 'ความสูง' },
  ] };
}

function segsIntersect(p1: P, p2: P, p3: P, p4: P): boolean {
  const o = (a: P, b: P, c: P) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, p3) * o(p1, p2, p4) < 0 && o(p3, p4, p1) * o(p3, p4, p2) < 0;
}

function rectilinear(s: RectilinearSpec): Scene {
  if (!s.moves || s.moves.length < 4) throw new FigureError('รูปเหลี่ยมมุมฉากต้องมีอย่างน้อย 4 ด้าน');
  const step: Record<string, P> = { R: pt(1, 0), L: pt(-1, 0), U: pt(0, 1), D: pt(0, -1) };
  const pts: P[] = [pt(0, 0)];
  s.moves.forEach((m, i) => {
    if (!step[m.dir]) throw new FigureError(`ทิศที่ ${i + 1} ไม่ถูกต้อง (ใช้ R U L D)`);
    pos(m.len, `ความยาวด้านที่ ${i + 1}`);
    if (i > 0 && (s.moves[i - 1].dir === m.dir)) throw new FigureError(`ด้านที่ ${i} และ ${i + 1} ไปทิศเดียวกัน ให้รวมเป็นด้านเดียว`);
    pts.push(add(pts[pts.length - 1], mul(step[m.dir], m.len)));
  });
  const end = pts.pop()!;
  if (dist(end, pts[0]) > 1e-9) throw new FigureError('เส้นรอบรูปไม่บรรจบจุดเริ่มต้น (ผลรวมขวา = ซ้าย และ ขึ้น = ลง)');
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) throw new FigureError('เส้นรอบรูปตัดกันเอง');
  }
  const area2 = pts.reduce((acc, p, i) => acc + (p.x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * p.y), 0);
  const prims: Prim[] = [{ t: 'path', pts, closed: true }];
  const constraints: Constraint[] = [];
  s.moves.forEach((m, i) => {
    const a = pts[i], b = pts[(i + 1) % n];
    constraints.push({ kind: 'length', a, b, value: m.len, what: `ด้านที่ ${i + 1}` });
    const t = lblText(m.label, m.len, s.unit);
    if (!t) return;
    // ด้านนอก: เดินทวนเข็ม → นอกรูปอยู่ทางขวาของทิศเดิน
    const d = step[m.dir];
    const outward = area2 > 0 ? pt(d.y, -d.x) : pt(-d.y, d.x);
    prims.push({ t: 'text', at: mid(a, b), text: t, dx: outward.x * 16, dy: -outward.y * 14,
      anchor: outward.x > 0.5 ? 'start' : outward.x < -0.5 ? 'end' : 'middle' });
  });
  return { prims, constraints, pixelSpace: false, geometric: true };
}

function angles(s: AnglesSpec): Scene {
  if (!s.rays || s.rays.length < 2) throw new FigureError('ต้องมีรังสีอย่างน้อย 2 เส้น');
  const O = pt(0, 0), L = 1;
  const ends = s.rays.map((d, i) => {
    if (!Number.isFinite(d)) throw new FigureError(`ทิศของรังสีที่ ${i + 1} ไม่ถูกต้อง`);
    return pt(L * Math.cos(rad(d)), L * Math.sin(rad(d)));
  });
  const prims: Prim[] = ends.map((e) => ({ t: 'path', pts: [O, e] }) as Prim);
  const constraints: Constraint[] = [];
  for (const m of s.marks ?? []) {
    if (!(m.from in s.rays) || !(m.to in s.rays)) throw new FigureError('เครื่องหมายมุมอ้างถึงรังสีที่ไม่มี');
    const a1 = norm360(s.rays[m.from]), a2 = norm360(s.rays[m.to]);
    const val = norm360(a2 - a1);
    if (val === 0) throw new FigureError('มุมที่ทำเครื่องหมายมีขนาด 0°');
    const label = lblText(m.label, val, undefined, '°');
    if (Math.abs(val - 90) < 1e-9) {
      prims.push({ t: 'right', c: O, a1, a2, size: 13 });
      if (label && label !== '90°') pushAngleLabel(prims, O, a1, a2, label, 30);
    } else {
      const r = val < 35 ? 34 : 22;
      prims.push({ t: 'arc', c: O, a1, a2, r });
      if (label) pushAngleLabel(prims, O, a1, a2, label, r + 14);
    }
    constraints.push({ kind: 'angle', a: ends[m.from], v: O, b: ends[m.to], value: val, what: `มุม ${label ?? fmtNum(val) + '°'}` });
  }
  if (s.vertex) prims.push({ t: 'text', at: O, text: s.vertex, dx: 0, dy: 16, bold: true });
  (s.rayNames ?? []).forEach((nm, i) => {
    if (!nm || !ends[i]) return;
    const d = rad(s.rays[i]);
    prims.push({ t: 'text', at: ends[i], text: nm, dx: Math.cos(d) * 12, dy: -Math.sin(d) * 12, bold: true });
  });
  prims.push({ t: 'dot', at: O, r: 2.5 });
  return { prims, constraints, pixelSpace: false, geometric: true };
}

function circle(s: CircleSpec): Scene {
  const r = pos(s.radius, 'รัศมี');
  const O = pt(0, 0);
  const prims: Prim[] = [{ t: 'circle', c: O, r }, { t: 'dot', at: O, r: 2.5 }];
  const constraints: Constraint[] = [];
  const mode = s.show ?? 'radius';
  if (mode === 'radius') {
    const E = pt(r * Math.cos(rad(25)), r * Math.sin(rad(25)));
    prims.push({ t: 'path', pts: [O, E] });
    const t = lblText(s.label, r, s.unit);
    if (t) prims.push({ t: 'text', at: mid(O, E), text: t, dx: -6, dy: -12 });
    constraints.push({ kind: 'length', a: O, b: E, value: r, what: 'รัศมี' });
  } else if (mode === 'diameter') {
    const E1 = pt(-r, 0), E2 = pt(r, 0);
    prims.push({ t: 'path', pts: [E1, E2] });
    const t = lblText(s.label, 2 * r, s.unit);
    if (t) prims.push({ t: 'text', at: pt(r / 2, 0), text: t, dy: -12 });
    constraints.push({ kind: 'length', a: E1, b: E2, value: 2 * r, what: 'เส้นผ่านศูนย์กลาง' });
  }
  if (s.center) prims.push({ t: 'text', at: O, text: s.center, dx: -4, dy: 14, bold: true, anchor: 'end' });
  // ตรวจว่าวงกลมกว้างเท่าเส้นผ่านศูนย์กลาง
  constraints.push({ kind: 'length', a: pt(-r, 0), b: pt(r, 0), value: 2 * r, what: 'เส้นผ่านศูนย์กลาง' });
  return { prims, constraints, pixelSpace: false, geometric: true };
}

function cuboid(s: CuboidSpec): Scene {
  const w = pos(s.w, 'ความกว้าง'), h = pos(s.h, 'ความสูง'), d = pos(s.d, 'ความลึก');
  // ภาพฉายเฉียง (cabinet): ความลึกย่อครึ่ง ทำมุม 40° — กว้าง/สูง ตามสัดส่วนจริง
  const k = pt(0.5 * d * Math.cos(rad(40)), 0.5 * d * Math.sin(rad(40)));
  const A = pt(0, 0), B = pt(w, 0), C = pt(w, h), D = pt(0, h);
  const [E, F, G, H] = [A, B, C, D].map((p) => add(p, k));
  const prims: Prim[] = [
    { t: 'path', pts: [A, B, C, D], closed: true },
    { t: 'path', pts: [B, F, G, C] },
    { t: 'path', pts: [D, H, G] },
    { t: 'path', pts: [A, E, F], dashed: true },
    { t: 'path', pts: [E, H], dashed: true },
  ];
  const ctr = centroid([A, B, C, D]);
  const sh = s.show ?? {};
  const tw = lblText(sh.w, w, s.unit), th = lblText(sh.h, h, s.unit), td = lblText(sh.d, d, s.unit);
  if (tw) prims.push(sideLabel(A, B, ctr, tw));
  if (th) prims.push(sideLabel(D, A, ctr, th, 18));
  if (td) prims.push({ t: 'text', at: mid(B, F), text: td, dx: 10, dy: 8, anchor: 'start' });
  return { prims, pixelSpace: false, geometric: true, constraints: [
    { kind: 'length', a: A, b: B, value: w, what: 'ความกว้าง' },
    { kind: 'length', a: A, b: D, value: h, what: 'ความสูง' },
  ] };
}

// ---------- แผนภูมิ (พิกัดพิกเซล แกน y ชี้ขึ้น) ----------
export function niceStep(maxVal: number, targetTicks = 5): number {
  if (maxVal <= 0) return 1;
  const raw = maxVal / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

function checkSeries(categories: string[], values: number[]) {
  if (!categories?.length) throw new FigureError('ต้องมีรายการอย่างน้อย 1 รายการ');
  if (categories.length !== values?.length) throw new FigureError('จำนวนรายการกับจำนวนค่าไม่เท่ากัน');
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new FigureError(`ค่าของ "${categories[i]}" ไม่ใช่ตัวเลข`);
    if (v < 0) throw new FigureError(`ค่าของ "${categories[i]}" ติดลบ`);
  });
}

function axes(prims: Prim[], s: { title?: string; yLabel?: string; step?: number; categories: string[]; values: number[] },
              plotW: number, plotH: number) {
  const vmax = Math.max(...s.values, 0);
  const step = s.step && s.step > 0 ? s.step : niceStep(vmax || 1);
  if (vmax / step > 40) throw new FigureError('ระยะห่างเส้นตารางเล็กเกินไป');
  const top = Math.max(step, Math.ceil(vmax / step - 1e-9) * step);
  const yOf = (v: number) => (v / top) * plotH;
  for (let v = 0; v <= top + 1e-9; v += step) {
    prims.push({ t: 'path', pts: [pt(0, yOf(v)), pt(plotW, yOf(v))], stroke: '#c9c9c9', width: 0.8 });
    prims.push({ t: 'text', at: pt(0, yOf(v)), text: fmtNum(v), dx: -6, anchor: 'end', size: 12 });
  }
  prims.push({ t: 'path', pts: [pt(0, plotH + 8), pt(0, 0), pt(plotW + 8, 0)], width: 1.4 });
  if (s.yLabel) prims.push({ t: 'text', at: pt(0, plotH + 8), text: s.yLabel, dy: -14, anchor: 'start', size: 12 });
  if (s.title) prims.push({ t: 'text', at: pt(plotW / 2, plotH + 8), text: s.title, dy: -34, bold: true });
  return { yOf };
}

function barChart(s: BarChartSpec): Scene {
  checkSeries(s.categories, s.values);
  const n = s.values.length, slot = Math.max(44, Math.min(70, 360 / n)), plotW = slot * n, plotH = 180;
  const prims: Prim[] = [];
  const { yOf } = axes(prims, s, plotW, plotH);
  const constraints: Constraint[] = [];
  s.values.forEach((v, i) => {
    const x0 = i * slot + slot * 0.2, x1 = (i + 1) * slot - slot * 0.2;
    const top = yOf(v);
    prims.push({ t: 'path', pts: [pt(x0, 0), pt(x0, top), pt(x1, top), pt(x1, 0)], closed: true, fill: '#9cc9bb' });
    prims.push({ t: 'text', at: pt((x0 + x1) / 2, 0), text: s.categories[i], dy: 14, size: 12 });
    if (s.showValues) prims.push({ t: 'text', at: pt((x0 + x1) / 2, top), text: fmtNum(v), dy: -9, size: 12 });
    constraints.push({ kind: 'length', a: pt(x0, 0), b: pt(x0, top), value: v, what: `แท่ง ${s.categories[i]}` });
  });
  return { prims, constraints, pixelSpace: true, geometric: false };
}

function lineGraph(s: LineGraphSpec): Scene {
  checkSeries(s.categories, s.values);
  const n = s.values.length, slot = Math.max(44, Math.min(70, 360 / n)), plotW = slot * n, plotH = 180;
  const prims: Prim[] = [];
  const { yOf } = axes(prims, s, plotW, plotH);
  const constraints: Constraint[] = [];
  const pts = s.values.map((v, i) => pt(i * slot + slot / 2, yOf(v)));
  prims.push({ t: 'path', pts, width: 2 });
  pts.forEach((p, i) => {
    prims.push({ t: 'dot', at: p, r: 3.5 });
    prims.push({ t: 'text', at: pt(p.x, 0), text: s.categories[i], dy: 14, size: 12 });
    if (s.showValues) prims.push({ t: 'text', at: p, text: fmtNum(s.values[i]), dy: -11, size: 12 });
    constraints.push({ kind: 'length', a: pt(p.x, 0), b: p, value: s.values[i], what: `จุด ${s.categories[i]}` });
  });
  return { prims, constraints, pixelSpace: true, geometric: false };
}

const PIE_FILLS = ['#9cc9bb', '#f2c38b', '#a9c1e8', '#e8a9b8', '#cfe39b', '#d6b8e8', '#f0e08a', '#b8dde0'];

function pieChart(s: PieChartSpec): Scene {
  checkSeries(s.categories, s.values);
  const sum = s.values.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new FigureError('ผลรวมของค่าต้องมากกว่า 0');
  if (s.values.length > PIE_FILLS.length) throw new FigureError(`แผนภูมิรูปวงกลมรองรับไม่เกิน ${PIE_FILLS.length} รายการ`);
  const R = 90, O = pt(0, 0);
  const prims: Prim[] = [];
  const constraints: Constraint[] = [];
  let a = 90;
  s.values.forEach((v, i) => {
    const sweep = (v / sum) * 360;
    const a2 = a - sweep;   // เรียงตามเข็มนาฬิกาจากด้านบน
    if (sweep > 0) {
      prims.push({ t: 'sector', c: O, r: R, a1: a2, a2: a, fill: PIE_FILLS[i] });
      const midA = rad((a + a2) / 2);
      const mode = s.labelMode ?? 'percent';
      const txt = mode === 'percent' ? `${fmtNum((v / sum) * 100)}%` : mode === 'value' ? fmtNum(v) : null;
      if (txt && sweep >= 12) prims.push({ t: 'text', at: pt(Math.cos(midA) * R * 0.62, Math.sin(midA) * R * 0.62), text: txt, size: 12 });
      if (sweep < 180) constraints.push({ kind: 'angle', a: pt(Math.cos(rad(a)), Math.sin(rad(a))), v: O,
        b: pt(Math.cos(rad(a2)), Math.sin(rad(a2))), value: sweep, what: `ส่วน ${s.categories[i]}` });
    }
    a = a2;
  });
  prims.push({ t: 'circle', c: O, r: R });
  s.categories.forEach((c, i) => {
    const y = R - 10 - i * 22;
    prims.push({ t: 'path', pts: [pt(R + 24, y - 6), pt(R + 36, y - 6), pt(R + 36, y + 6), pt(R + 24, y + 6)], closed: true, fill: PIE_FILLS[i] });
    prims.push({ t: 'text', at: pt(R + 42, y), text: c, anchor: 'start', size: 13 });
  });
  if (s.title) prims.push({ t: 'text', at: pt(0, R), text: s.title, dy: -22, bold: true });
  return { prims, constraints, pixelSpace: true, geometric: false };
}

function numberLine(s: NumberLineSpec): Scene {
  const min = need(s.min, 'ค่าต่ำสุด'), max = need(s.max, 'ค่าสูงสุด'), step = pos(s.step, 'ระยะขีดหลัก');
  if (max <= min) throw new FigureError('ค่าสูงสุดต้องมากกว่าค่าต่ำสุด');
  const majors = Math.round((max - min) / step);
  if (Math.abs(majors * step - (max - min)) > 1e-9) throw new FigureError('ช่วง (สูงสุด − ต่ำสุด) ต้องหารด้วยระยะขีดหลักลงตัว');
  if (majors > 24) throw new FigureError('ขีดหลักมากเกินไป (ไม่เกิน 24 ช่อง)');
  const minor = Math.max(1, Math.round(s.minor ?? 1));
  const W = Math.min(440, Math.max(240, majors * 48));
  const xOf = (v: number) => ((v - min) / (max - min)) * W;
  const prims: Prim[] = [{ t: 'path', pts: [pt(-16, 0), pt(W + 16, 0)], width: 1.4 }];
  prims.push({ t: 'path', pts: [pt(-8, 5), pt(-16, 0), pt(-8, -5)] }, { t: 'path', pts: [pt(W + 8, 5), pt(W + 16, 0), pt(W + 8, -5)] });
  for (let i = 0; i <= majors * minor; i++) {
    const v = min + (i * step) / minor, x = xOf(v), major = i % minor === 0;
    prims.push({ t: 'path', pts: [pt(x, major ? 7 : 4), pt(x, major ? -7 : -4)] });
    if (major) prims.push({ t: 'text', at: pt(x, 0), text: fmtNum(v), dy: 20, size: 13 });
  }
  const constraints: Constraint[] = [];
  for (const p of s.points ?? []) {
    if (!Number.isFinite(p.value) || p.value < min || p.value > max) throw new FigureError(`จุด ${p.label ?? p.value} อยู่นอกเส้นจำนวน`);
    const P0 = pt(xOf(p.value), 0);
    prims.push({ t: 'dot', at: P0, r: 4 });
    if (p.label) prims.push({ t: 'text', at: P0, text: p.label, dy: -16, bold: true });
    constraints.push({ kind: 'length', a: pt(0, 0), b: P0, value: p.value - min, what: `ตำแหน่ง ${p.label ?? p.value}` });
  }
  constraints.push({ kind: 'length', a: pt(0, 0), b: pt(W, 0), value: max - min, what: 'ความยาวเส้นจำนวน' });
  return { prims, constraints, pixelSpace: true, geometric: false };
}

export function textWidth(text: string, size: number): number {
  // อักษรไทยที่เป็นสระบน/ล่าง/วรรณยุกต์ไม่กินที่ในแนวนอน
  const visible = [...text].filter((c) => !/[ัิ-ฺ็-๎]/.test(c)).length;
  return visible * size * 0.56;
}

function table(s: TableSpec): Scene {
  const header = s.header ?? [];
  const rows = s.rows ?? [];
  const cols = Math.max(header.length, ...rows.map((r) => r.length));
  if (!cols) throw new FigureError('ตารางว่าง');
  const all = [header, ...rows];
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(48, ...all.map((r) => textWidth(r[c] ?? '', 14) + 20)));
  const rowH = 28;
  const total = widths.reduce((a, b) => a + b, 0);
  const prims: Prim[] = [];
  const nRows = all.length - (header.length ? 0 : 1);
  const H = nRows * rowH;
  if (header.length) prims.push({ t: 'path', pts: [pt(0, H), pt(total, H), pt(total, H - rowH), pt(0, H - rowH)], closed: true, fill: '#eeeeee' });
  for (let r = 0; r <= nRows; r++) prims.push({ t: 'path', pts: [pt(0, H - r * rowH), pt(total, H - r * rowH)] });
  let x = 0;
  for (let c = 0; c <= cols; c++) {
    prims.push({ t: 'path', pts: [pt(x, 0), pt(x, H)] });
    if (c < cols) x += widths[c];
  }
  (header.length ? all : rows).forEach((row, r) => {
    let cx = 0;
    for (let c = 0; c < cols; c++) {
      prims.push({ t: 'text', at: pt(cx + widths[c] / 2, H - r * rowH - rowH / 2), text: row[c] ?? '', size: 14,
        bold: !!header.length && r === 0 });
      cx += widths[c];
    }
  });
  return { prims, constraints: [], pixelSpace: true, geometric: false };
}

export function buildScene(spec: FigureSpec): Scene {
  if (!spec || typeof spec !== 'object' || !('kind' in spec)) throw new FigureError('ข้อกำหนดรูปไม่ถูกต้อง');
  const s = spec as FigureSpec;
  let scene: Scene;
  switch (s.kind) {
    case 'triangle': scene = triangle(s); break;
    case 'rectangle': scene = rectangle(s); break;
    case 'square': scene = square(s); break;
    case 'parallelogram': scene = parallelogram(s); break;
    case 'rhombus': scene = rhombus(s); break;
    case 'trapezoid': scene = trapezoid(s); break;
    case 'rectilinear': scene = rectilinear(s); break;
    case 'angles': scene = angles(s); break;
    case 'circle': scene = circle(s); break;
    case 'cuboid': scene = cuboid(s); break;
    case 'bar_chart': scene = barChart(s); break;
    case 'line_graph': scene = lineGraph(s); break;
    case 'pie_chart': scene = pieChart(s); break;
    case 'number_line': scene = numberLine(s); break;
    case 'table': scene = table(s); break;
    default: throw new FigureError(`ไม่รู้จักรูปชนิด "${(s as any).kind}"`);
  }
  scene.geometric = GEOMETRIC_KINDS.includes(s.kind);
  return scene;
}

// ---------- ตรวจว่ารูปที่วาดตรงกับตัวเลข ----------
export interface VerifyResult { ok: boolean; problems: string[]; checked: number }

/** ตรวจข้อกำหนดกับพิกัดที่ผ่านการย่อขยายแล้ว: ทุกความยาวต้องใช้มาตราส่วนเดียวกัน, ทุกมุมต้องตรง */
export function verifyScene(scene: Scene, map: (p: P) => P = (p) => p, tolLen = 0.005, tolDeg = 0.5): VerifyResult {
  const problems: string[] = [];
  let scale: number | null = null;
  for (const c of scene.constraints) {
    if (c.kind === 'length') {
      const actual = dist(map(c.a), map(c.b));
      if (c.value === 0) { if (actual > 1e-6) problems.push(`${c.what}: ควรยาว 0`); continue; }
      const k = actual / c.value;
      if (scale === null) scale = k;
      else if (Math.abs(k - scale) / scale > tolLen)
        problems.push(`${c.what}: สัดส่วนไม่ตรง (วาด ${actual.toFixed(2)} ต่อค่า ${fmtNum(c.value)})`);
    } else {
      const actual = angleAt(map(c.a), map(c.v), map(c.b));
      const want = c.value > 180 ? 360 - c.value : c.value;
      if (Math.abs(actual - want) > tolDeg) problems.push(`${c.what}: วาด ${actual.toFixed(1)}° แต่กำหนด ${fmtNum(c.value)}°`);
    }
  }
  return { ok: problems.length === 0, problems, checked: scene.constraints.length };
}
