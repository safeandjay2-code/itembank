// เครื่องอ่านกระดาษคำตอบ (OMR) — ทำงานในเครื่องที่ตรวจเท่านั้น ภาพไม่ถูกส่งออกไปไหน (SPEC §8.1)
// ขั้นตอน: อ่าน QR → ประมาณตำแหน่งกระดาษจาก QR → หามุมดำ 4 มุม → จัดภาพตรง (homography)
//          → วัดความเข้มของวงกลมทุกวงตามแบบกระดาษ (answer_sheet_template_vN.json)
// ผลลัพธ์เป็น "ความเข้ม" ดิบ 0–1 ต่อวง การตีความ (ฝน/ไม่ฝน/กำกวม) อยู่ที่ grade.ts
import jsQR from 'jsqr';
import { getTemplate, TEMPLATES, bubbleCenter, parseQrPayload, type QrData } from '../print/template';
import { ONET_TEMPLATES, on1AllBubbles, parseOnetQrPayload, type OnetQrData } from '../print/onetTemplate';
import { affineFromPoints, apply, fromPoints, localScale, type H, type Pt } from './homography';
import { crop, downscale, grayToRgba, otsu, percentile, sample, sharpen, upscale, type Gray } from './image';

export type ReadFailReason = 'no_qr' | 'not_our_sheet' | 'unknown_template' | 'corners' | 'low_contrast' | 'onet_sheet' | 'not_onet_sheet';

export const FAIL_TH: Record<ReadFailReason, string> = {
  no_qr: 'ยังหา QR ไม่เจอ — ให้เห็นกระดาษทั้งแผ่นและถือนิ่ง ๆ',
  not_our_sheet: 'QR นี้ไม่ใช่กระดาษคำตอบของระบบ',
  unknown_template: 'ไม่รู้จักรุ่นแบบกระดาษคำตอบ',
  corners: 'หามุมดำไม่ครบ 4 มุม — ให้เห็นมุมกระดาษทั้ง 4 มุม',
  low_contrast: 'ภาพมืดหรือเบลอเกินไป — เพิ่มแสงหรือถือให้นิ่ง',
  onet_sheet: 'นี่คือกระดาษคำตอบ O-NET — ให้สแกนในห้อง O-NET',
  not_onet_sheet: 'นี่คือกระดาษคำตอบของคลังข้อสอบ ไม่ใช่กระดาษคำตอบ O-NET',
};

export interface SheetReading {
  ok: true;
  qr: QrData;
  /** จุดศูนย์กลางมุมดำในภาพ (พิกเซล) ลำดับ tl, tr, bl, br */
  corners: Pt[];
  /** มม. → พิกเซล */
  homography: H;
  /** ความเข้มของวงกลม [ข้อที่ 1..ความจุ][ตัวเลือก 0..3] — 0 = ขาวเท่ากระดาษ, 1 = ดำเท่ามุมดำ */
  darkness: number[][];
  quality: {
    /** พิกเซลต่อ มม. */
    scale: number;
    /** ความต่างความสว่างระหว่างมุมดำกับกระดาษ 0–1 */
    contrast: number;
    /** ระยะคลาดเฉลี่ยระหว่าง QR ที่อ่านได้กับตำแหน่งตามแบบกระดาษ (มม.) */
    fitErrorMm: number;
  };
}
export interface ReadFailure { ok: false; reason: ReadFailReason; message: string; qr?: QrData }
export type ReadResult = SheetReading | ReadFailure;

/** ผลอ่านกระดาษคำตอบ O-NET (ON1) — ความเข้มดิบรายวงตามชื่อวงใน on1AllBubbles (set:100, q1:2, seat:c0:7, q12:c2:5 …)
 *  การตีความอยู่ที่ onetGrade.ts */
export interface OnetSheetReading {
  ok: true;
  qr: OnetQrData;
  corners: Pt[];
  homography: H;
  darkness: Record<string, number>;
  quality: SheetReading['quality'];
}
export interface OnetReadFailure { ok: false; reason: ReadFailReason; message: string; qr?: OnetQrData }
export type OnetReadResult = OnetSheetReading | OnetReadFailure;

const fail = (reason: ReadFailReason, qr?: QrData): ReadFailure => ({ ok: false, reason, message: FAIL_TH[reason], qr });
const failOnet = (reason: ReadFailReason, qr?: OnetQrData): OnetReadFailure => ({ ok: false, reason, message: FAIL_TH[reason], qr });

/** ส่วนของแบบกระดาษที่ใช้หาตำแหน่งกระดาษ (เหมือนกันทั้งแบบระบบหลักและ ON1) */
interface SheetLayout {
  paper: { width: number; height: number };
  qr: { x: number; y: number; size: number };
  corner_marks: { size: number; top_left: number[][] };
}

type ParsedQr = { kind: 'ib'; qr: QrData; layout: SheetLayout | null } | { kind: 'onet'; qr: OnetQrData; layout: SheetLayout | null };

interface QrHit { text: string; version: number; points: Array<{ mm: Pt; px: Pt }>; parsed: ParsedQr }

/** แยกชนิด QR: ระบบหลัก (IB1/IB2) หรือ O-NET (ON1) */
function parseAnyQr(text: string): ParsedQr | null {
  const ib = parseQrPayload(text);
  if (ib) return { kind: 'ib', qr: ib, layout: TEMPLATES[ib.template] ?? null };
  const on = parseOnetQrPayload(text);
  if (on) return { kind: 'onet', qr: on, layout: ONET_TEMPLATES[on.template] ?? null };
  return null;
}

/** พิกัด มม. ของจุดอ้างอิงใน QR (มุมสัญลักษณ์ + จุดศูนย์กลาง finder) ตามวิธีวาดใน answerSheetSvg.qrPath */
function qrGeometry(t: SheetLayout, version: number) {
  const n = 17 + 4 * version;
  const m = t.qr.size / (n + 8);
  const at = (cx: number, cy: number): Pt => ({ x: t.qr.x + (4 + cx) * m, y: t.qr.y + (4 + cy) * m });
  return {
    topLeftCorner: at(0, 0), topRightCorner: at(n, 0), bottomLeftCorner: at(0, n), bottomRightCorner: at(n, n),
    topLeftFinderPattern: at(3.5, 3.5), topRightFinderPattern: at(n - 3.5, 3.5), bottomLeftFinderPattern: at(3.5, n - 3.5),
  };
}

const QR_KEYS = ['topLeftFinderPattern', 'topRightFinderPattern', 'bottomLeftFinderPattern',
  'topLeftCorner', 'topRightCorner', 'bottomLeftCorner', 'bottomRightCorner'] as const;

/** ตัวคูณย่อภาพที่จะลองอ่าน QR — ภาพย่อช่วยลดสัญญาณรบกวน (แสงน้อย) และเร็วกว่า */
export function qrFactors(w: number, h: number, targets: number[] = [1000, 1400, 700, 0]): number[] {
  const big = Math.max(w, h);
  const out: number[] = [];
  for (const t of targets) {
    const f = t ? Math.max(1, big / t) : 1;
    if (!out.some((x) => Math.abs(x - f) < 0.2)) out.push(f);
  }
  return out;
}

/** อ่าน QR — ลองหลายขนาดจนกว่าจะเจอ (sharpen = ลองภาพที่เพิ่มความคมด้วย สำหรับภาพเบลอ) */
function findQr(g: Gray, factors: number[], sharpenToo: boolean, upscales: number[] = []): { hit: QrHit | null; raw: string | null } {
  const tries: Array<{ f: number; sharp: boolean }> = factors.map((f) => ({ f, sharp: false }));
  if (sharpenToo) tries.push(...factors.filter((f) => f < 2.2).map((f) => ({ f, sharp: true })));
  // ขยายภาพ (f < 1) — ลองท้ายสุด เฉพาะเมื่อขอ (กระดาษ O-NET A4 ที่ QR เล็กในภาพ)
  for (const u of upscales) tries.push({ f: 1 / u, sharp: false }, { f: 1 / u, sharp: true });
  for (const { f, sharp } of tries) {
    const base = f < 1 ? upscale(g, 1 / f) : downscale(g, f);
    const s = sharp ? sharpen(base, 2, 2) : base;
    const r = jsQR(grayToRgba(s), s.w, s.h, { inversionAttempts: 'dontInvert' });
    if (!r) continue;
    const parsed = parseAnyQr(r.data);
    if (!parsed) return { hit: null, raw: r.data };
    const geo = parsed.layout ? qrGeometry(parsed.layout, r.version) : null;
    // พิกัดใน jsQR อ้างจุดกึ่งกลางพิกเซล → แปลงกลับเป็นภาพเต็ม
    const points = geo ? QR_KEYS.map((k) => ({ mm: geo[k], px: { x: ((r.location as any)[k].x + 0.5) * f - 0.5, y: ((r.location as any)[k].y + 0.5) * f - 0.5 } })) : [];
    return { hit: { text: r.data, version: r.version, points, parsed }, raw: r.data };
  }
  return { hit: null, raw: null };
}

interface Cand { x: number; y: number; area: number }

/** หาสี่เหลี่ยมดำทึบทั้งภาพ (ภาพย่อ ~2.5 พิกเซล/มม.) ที่มีกระดาษสว่างล้อมรอบ */
function markCandidates(g: Gray, pxPerMm: number, sizeMm: number): Cand[] {
  const f = Math.max(1, pxPerMm / 2.5);
  const s = downscale(g, f);
  const ppm = pxPerMm / f;
  const W = s.w, Hh = s.h;
  const I = new Float64Array((W + 1) * (Hh + 1));
  for (let y = 0; y < Hh; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += s.d[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; }
  }
  const boxSum = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(Hh, y1);
    return { sum: I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0], n: Math.max(1, (x1 - x0) * (y1 - y0)) };
  };
  const r = Math.max(4, Math.round(ppm * 9));
  const dark = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const b = boxSum(x - r, y - r, x + r + 1, y + r + 1);
    const mean = b.sum / b.n, v = s.d[y * W + x];
    if (v < mean * 0.72 && mean - v > 12) dark[y * W + x] = 1;
  }
  const expected = (sizeMm * ppm) ** 2;
  const lab = new Int32Array(W * Hh);
  const out: Cand[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let i0 = 0; i0 < dark.length; i0++) {
    if (!dark[i0] || lab[i0]) continue;
    next++; lab[i0] = next; stack.push(i0);
    let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sv = 0, touches = false;
    let minX = W, minY = Hh, maxX = 0, maxY = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i - x) / W;
      area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sv += s.d[i];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === Hh - 1) touches = true;
      if (x > 0 && dark[i - 1] && !lab[i - 1]) { lab[i - 1] = next; stack.push(i - 1); }
      if (x < W - 1 && dark[i + 1] && !lab[i + 1]) { lab[i + 1] = next; stack.push(i + 1); }
      if (y > 0 && dark[i - W] && !lab[i - W]) { lab[i - W] = next; stack.push(i - W); }
      if (y < Hh - 1 && dark[i + W] && !lab[i + W]) { lab[i + W] = next; stack.push(i + W); }
    }
    if (touches || area < expected * 0.45 || area > expected * 2.3) continue;
    const mx = sx / area, my = sy / area;
    const cxx = sxx / area - mx * mx, cyy = syy / area - my * my, cxy = sxy / area - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (l2 <= 0 || l1 / l2 > 2.2) continue;
    if (area / (12 * Math.sqrt(l1 * l2)) < 0.72) continue;
    // กรอบรอบ ๆ ต้องสว่าง (อยู่บนกระดาษ ไม่ใช่ลายพื้นโต๊ะ)
    const side = Math.sqrt(area);
    const pad = Math.ceil(side * 0.9);
    const box = boxSum(minX - pad, minY - pad, maxX + pad + 1, maxY + pad + 1);
    const around = (box.sum - sv) / Math.max(1, box.n - area);
    if (sv / area > around * 0.6) continue;
    out.push({ x: (mx + 0.5) * f - 0.5, y: (my + 0.5) * f - 0.5, area: area * f * f });
  }
  return out;
}

interface Blob { x: number; y: number; area: number; mean: number }

/** หาสี่เหลี่ยมดำใกล้ตำแหน่งที่คาด (พิกเซล) ภายในหน้าต่าง ±winMm มม. */
function findMark(g: Gray, pred: Pt, scale: number, sizeMm: number, winMm: number): (Blob & { white: number }) | null {
  const half = Math.max(8, Math.round(winMm * scale));
  const x0 = Math.max(0, Math.round(pred.x - half)), x1 = Math.min(g.w - 1, Math.round(pred.x + half));
  const y0 = Math.max(0, Math.round(pred.y - half)), y1 = Math.min(g.h - 1, Math.round(pred.y + half));
  const W = x1 - x0 + 1, Hh = y1 - y0 + 1;
  if (W < 8 || Hh < 8) return null;
  const hist = new Uint32Array(256);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) hist[g.d[y * g.w + x]]++;
  const th = otsu(hist, W * Hh);
  const lab = new Int32Array(W * Hh);
  const expected = (sizeMm * scale) ** 2;
  const stack: number[] = [];
  let best: Blob | null = null, bestDist = Infinity;
  let next = 0;
  for (let sy = 0; sy < Hh; sy++) for (let sx = 0; sx < W; sx++) {
    const si = sy * W + sx;
    if (lab[si] || g.d[(sy + y0) * g.w + sx + x0] > th) continue;
    next++;
    lab[si] = next; stack.push(si);
    let area = 0, sxSum = 0, sySum = 0, sxx = 0, syy = 0, sxy = 0, vSum = 0, touches = false;
    while (stack.length) {
      const i = stack.pop()!;
      const px = i % W, py = (i - px) / W;
      area++; sxSum += px; sySum += py; sxx += px * px; syy += py * py; sxy += px * py; vSum += g.d[(py + y0) * g.w + px + x0];
      if (px === 0 || py === 0 || px === W - 1 || py === Hh - 1) touches = true;
      const nb = [i - 1, i + 1, i - W, i + W];
      for (let k = 0; k < 4; k++) {
        const j = nb[k];
        if (k === 0 && px === 0) continue;
        if (k === 1 && px === W - 1) continue;
        if (j < 0 || j >= lab.length || lab[j]) continue;
        const jx = j % W, jy = (j - jx) / W;
        if (g.d[(jy + y0) * g.w + jx + x0] > th) continue;
        lab[j] = next; stack.push(j);
      }
    }
    if (touches || area < expected * 0.4 || area > expected * 2.2) continue;
    const mx = sxSum / area, my = sySum / area;
    const cxx = sxx / area - mx * mx, cyy = syy / area - my * my, cxy = sxy / area - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (l2 <= 0 || l1 / l2 > 2.2) continue;               // ต้องเกือบจัตุรัส (ไม่ยาว)
    const fill = area / (12 * Math.sqrt(l1 * l2));          // จัตุรัสทึบ ≈ 1.0 · วงแหวน/กรอบ < 0.7
    if (fill < 0.75) continue;
    const c = { x: mx + x0, y: my + y0 };
    const dist = Math.hypot(c.x - pred.x, c.y - pred.y);
    if (dist < bestDist) { bestDist = dist; best = { ...c, area, mean: vSum / area }; }
  }
  if (!best) return null;
  // ความสว่างกระดาษรอบมุม: เปอร์เซ็นไทล์สูงของหน้าต่าง
  const vals: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(W, Hh) / 40));
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) vals.push(g.d[y * g.w + x]);
  return { ...best, white: percentile(vals, 0.85) };
}

/** ฟิตระนาบความสว่าง v ≈ a + b·x + c·y แบบตัดจุดมืดผิดปกติ (รอยดินสอเลยขอบ/ตัวอักษร) ออก 1 รอบ */
function fitPlane(pts: Array<{ x: number; y: number; v: number }>): [number, number, number] {
  const fit = (ps: typeof pts): [number, number, number] => {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sv = 0, sxv = 0, syv = 0;
    for (const p of ps) { n++; sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; sv += p.v; sxv += p.x * p.v; syv += p.y * p.v; }
    if (n < 6) return [ps.reduce((a, p) => Math.max(a, p.v), 1), 0, 0];
    const det = n * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
    if (Math.abs(det) < 1e-9) return [sv / n, 0, 0];
    const a = (sv * (sxx * syy - sxy * sxy) - sx * (sxv * syy - sxy * syv) + sy * (sxv * sxy - sxx * syv)) / det;
    const b = (n * (sxv * syy - sxy * syv) - sv * (sx * syy - sxy * sy) + sy * (sx * syv - sxv * sy)) / det;
    const c = (n * (sxx * syv - sxv * sxy) - sx * (sx * syv - sxv * sy) + sv * (sx * sxy - sxx * sy)) / det;
    return [a, b, c];
  };
  let f = fit(pts);
  const kept = pts.filter((p) => p.v >= 0.85 * (f[0] + f[1] * p.x + f[2] * p.y));
  if (kept.length >= pts.length * 0.5) f = fit(kept);
  return f;
}

/** จุดตัวอย่างในวงกลม (มม. สัมพัทธ์) */
function diskOffsets(r0: number, r1: number, step: number): Pt[] {
  const out: Pt[] = [];
  for (let y = -r1; y <= r1 + 1e-9; y += step) for (let x = -r1; x <= r1 + 1e-9; x += step) {
    const d = Math.hypot(x, y);
    if (d >= r0 && d <= r1) out.push({ x, y });
  }
  return out;
}

export interface ReadOptions {
  /** ตัวคูณย่อภาพที่จะลองอ่าน QR ตามลำดับ (ค่าเริ่มต้น: ลองหลายขนาด) — โหมดกล้องส่งมา 1 ค่าต่อเฟรมเพื่อความเร็ว */
  qrFactors?: number[];
  /** ลองภาพเพิ่มความคมเมื่ออ่าน QR ไม่ได้ (ค่าเริ่มต้น: ลองเมื่อไม่ได้กำหนด qrFactors เช่น โหมดอัปโหลด) */
  sharpen?: boolean;
  /** ตัวคูณขยายภาพที่จะลองอ่าน QR เป็นทางสุดท้าย (ตัวอ่าน O-NET เท่านั้น · ค่าเริ่มต้น: ไม่ลอง) */
  qrUpscales?: number[];
}

interface Located { corners: Pt[]; H: H; scale: number; contrast: number; fitErrorMm: number }

/** หาตำแหน่งกระดาษจาก QR + มุมดำ 4 มุม (ใช้ร่วมกันทั้งแบบระบบหลักและ ON1) */
function locate(g: Gray, hit: QrHit, t: SheetLayout): Located | ReadFailReason {
  // 1) ตำแหน่งคร่าว ๆ จาก QR (QR เล็ก จึงคาดตำแหน่งมุมไกล ๆ ได้หยาบ)
  const h0 = affineFromPoints(hit.points.map((p) => p.mm), hit.points.map((p) => p.px));
  if (!h0) return 'corners';
  const k = t.corner_marks.size;
  const markMm: Pt[] = t.corner_marks.top_left.map(([x, y]) => ({ x: x + k / 2, y: y + k / 2 }));
  const s0 = localScale(h0, { x: t.qr.x + t.qr.size / 2, y: t.qr.y + t.qr.size / 2 });
  // 2) สี่เหลี่ยมดำทั้งภาพ → เลือกชุด 4 มุมที่ทำให้ QR ตกตรงตำแหน่งตามแบบกระดาษมากที่สุด
  const cands = markCandidates(g, s0, k);
  const near = markMm.map((m) => {
    const p = apply(h0, m);
    return cands.map((c) => ({ c, d: Math.hypot(c.x - p.x, c.y - p.y) }))
      .filter((o) => o.d < 60 * s0).sort((a, b) => a.d - b.d).slice(0, 4).map((o) => o.c);
  });
  if (near.some((l) => !l.length)) return 'corners';
  const finders = hit.points.slice(0, 3);
  const fitErr = (H: H) => finders.reduce((a, p) => { const q = apply(H, p.mm); return a + Math.hypot(q.x - p.px.x, q.y - p.px.y); }, 0) / 3;
  let best: { combo: Cand[]; err: number } | null = null;
  for (const a of near[0]) for (const b of near[1]) for (const c of near[2]) for (const d of near[3]) {
    const combo = [a, b, c, d];
    const Hc = fromPoints(markMm, combo);
    if (!Hc) continue;
    const sizes = combo.map((q) => q.area);
    if (Math.max(...sizes) > 3 * Math.min(...sizes)) continue;
    const err = fitErr(Hc);
    if (!best || err < best.err) best = { combo, err };
  }
  if (!best) return 'corners';
  // 3) ปรับจุดศูนย์กลางมุมดำให้ละเอียดที่ความละเอียดเต็ม
  const coarseH = fromPoints(markMm, best.combo)!;
  const found = best.combo.map((c, i) => findMark(g, c, localScale(coarseH, markMm[i]), k, 6.5));
  if (found.some((f) => !f)) return 'corners';
  const corners = found.map((f) => ({ x: f!.x, y: f!.y }));
  const H = fromPoints(markMm, corners);
  if (!H) return 'corners';

  // ตรวจความสมเหตุสมผล: QR ที่อ่านได้ต้องอยู่ตรงตำแหน่งตามแบบกระดาษ
  const scale = localScale(H, { x: t.paper.width / 2, y: t.paper.height / 2 });
  const fitErrorMm = fitErr(H) / scale;
  if (fitErrorMm > 3) return 'corners';

  // ระดับดำ/ขาวจากมุมดำ (สัดส่วน — ทนต่อแสงน้อย/เงา)
  const blackRatio = found.reduce((a, f) => a + f!.mean / Math.max(1, f!.white), 0) / 4;
  const contrast = 1 - blackRatio;
  if (contrast < 0.3) return 'low_contrast';
  return { corners, H, scale, contrast, fitErrorMm };
}

/** วัดความเข้มของวงกลม 1 วง (จุดศูนย์กลาง มม., รัศมี มม.) → 0 = ขาวเท่ากระดาษ, 1 = ดำเท่ามุมดำ */
function measureBubble(g: Gray, loc: Located, ctr: Pt, inner: Pt[], ring: Pt[]): number {
  const H = loc.H;
  // ความขาวอ้างอิงเฉพาะวงนี้: ระนาบความสว่างที่ฟิตจากวงแหวนรอบนอก (ทนต่อเงา/แสงไล่ระดับที่พาดผ่านวง)
  const ringPts = ring.map((o) => { const p = apply(H, { x: ctr.x + o.x, y: ctr.y + o.y }); return { x: o.x, y: o.y, v: sample(g, p.x, p.y) }; });
  const plane = fitPlane(ringPts);
  let sum = 0;
  for (const o of inner) {
    const p = apply(H, { x: ctr.x + o.x, y: ctr.y + o.y });
    const white = Math.max(1, plane[0] + plane[1] * o.x + plane[2] * o.y);
    sum += Math.min(1.2, sample(g, p.x, p.y) / white);
  }
  const d = (1 - sum / inner.length) / Math.max(0.2, loc.contrast);
  return Math.round(Math.min(1, Math.max(0, d)) * 1000) / 1000;
}

const diskCache = new Map<number, { inner: Pt[]; ring: Pt[] }>();
function bubbleSampling(r: number) {
  let v = diskCache.get(r);
  if (!v) { v = { inner: diskOffsets(0, r * 0.62, 0.22), ring: diskOffsets(r + 0.55, r + 0.95, 0.2) }; diskCache.set(r, v); }
  return v;
}

/** อ่านกระดาษคำตอบ 1 แผ่นจากภาพระดับเทา (แบบระบบหลัก IB1/IB2) */
export function readSheet(g: Gray, opts: ReadOptions = {}): ReadResult {
  const { hit, raw } = findQr(g, opts.qrFactors ?? qrFactors(g.w, g.h), opts.sharpen ?? !opts.qrFactors);
  if (!hit) return fail(raw ? 'not_our_sheet' : 'no_qr');
  if (hit.parsed.kind === 'onet') return fail('onet_sheet');
  const qr = hit.parsed.qr;
  if (!TEMPLATES[qr.template]) return fail('unknown_template', qr);
  const t = getTemplate(qr.template);
  const loc = locate(g, hit, t);
  if (typeof loc === 'string') return fail(loc, qr);

  // วัดความเข้มทุกวง
  const b = t.bubbles;
  const { inner, ring } = bubbleSampling(b.radius);
  const darkness: number[][] = [];
  for (let n = 1; n <= b.capacity; n++) {
    const row: number[] = [];
    for (let c = 1; c <= b.choices; c++) row.push(measureBubble(g, loc, bubbleCenter(t, n, c), inner, ring));
    darkness.push(row);
  }
  return { ok: true, qr, corners: loc.corners, homography: loc.H, darkness,
    quality: { scale: loc.scale, contrast: loc.contrast, fitErrorMm: loc.fitErrorMm } };
}

const JITTER = [-0.6, 0, 0.6];

/** อ่านกระดาษคำตอบ O-NET (ON1) 1 แผ่น — A4 แนวตั้ง 1 คนต่อแผ่น (SPEC-ONET §5) */
export function readOnetSheet(g: Gray, opts: ReadOptions = {}): OnetReadResult {
  // อัปโหลด (ไม่กำหนด qrFactors): ลองขยายภาพ 1.6 เท่าเป็นทางสุดท้าย — QR บน A4 ที่ถ่ายไกลมีโมดูลแค่ ~3 พิกเซล
  //   ภาพใหญ่อยู่แล้ว (> 2000 พิกเซล) ไม่ขยาย — ช้าและกินหน่วยความจำ
  const ups = (opts.qrUpscales ?? (opts.qrFactors ? [] : [1.6])).filter((u) => Math.max(g.w, g.h) * u <= 3200);
  const { hit, raw } = findQr(g, opts.qrFactors ?? qrFactors(g.w, g.h, [1400, 0, 1000]), opts.sharpen ?? !opts.qrFactors, ups);
  if (!hit) return failOnet(raw ? 'not_our_sheet' : 'no_qr');
  if (hit.parsed.kind === 'ib') return failOnet('not_onet_sheet');
  const qr = hit.parsed.qr;
  const t = ONET_TEMPLATES[qr.template];
  if (!t) return failOnet('unknown_template', qr);
  const loc = locate(g, hit, t);
  if (typeof loc === 'string') return failOnet(loc, qr);
  // A4 ใหญ่กว่า A5 — กระดาษโค้ง/ยับทำให้ตำแหน่งวงกลางแผ่นคลาดจาก homography ได้เกือบ 1 มม.
  // จึงวัดซ้ำรอบจุดที่คาด (±0.6 มม.) แล้วใช้ค่าเข้มสุด · ขอบเขตนี้ไม่ทำให้จุดวัดเลยเส้นขอบวง (วงในรัศมี 0.62r + 0.6 < r)
  const darkness: Record<string, number> = {};
  for (const b of on1AllBubbles(t)) {
    const { inner, ring } = bubbleSampling(b.r);
    let best = 0;
    for (const dy of JITTER) for (const dx of JITTER)
      best = Math.max(best, measureBubble(g, loc, { x: b.p.x + dx, y: b.p.y + dy }, inner, ring));
    darkness[b.key] = best;
  }
  return { ok: true, qr, corners: loc.corners, homography: loc.H, darkness,
    quality: { scale: loc.scale, contrast: loc.contrast, fitErrorMm: loc.fitErrorMm } };
}

/** ภาพหนึ่งอาจมีกระดาษคำตอบ 2 แผ่น (A4 แนวนอนที่ยังไม่ตัด) — แยกครึ่งซ้าย/ขวาแล้วอ่านทีละแผ่น */
export function readPage(g: Gray, opts: ReadOptions = {}): ReadResult[] {
  if (g.w > g.h * 1.15) {
    const halfW = Math.floor(g.w / 2);
    const left = readSheet(crop(g, 0, 0, halfW, g.h), opts);
    const right = readSheet(crop(g, halfW, 0, g.w - halfW, g.h), opts);
    const fixed = [left, right].map((r, i) => r.ok ? shift(r, i * halfW) : r);
    if (fixed.some((r) => r.ok)) return fixed;
  }
  if (g.h > g.w * 1.15 * 1.414) {
    // A4 แนวตั้งที่มีกระดาษ A5 บน-ล่าง (สแกนหมุน 90°)
    const halfH = Math.floor(g.h / 2);
    const top = readSheet(crop(g, 0, 0, g.w, halfH), opts);
    const bottom = readSheet(crop(g, 0, halfH, g.w, g.h - halfH), opts);
    const fixed = [top, bottom].map((r, i) => r.ok ? shift(r, 0, i * halfH) : r);
    if (fixed.some((r) => r.ok)) return fixed;
  }
  return [readSheet(g, opts)];
}

function shift(r: SheetReading, dx: number, dy = 0): SheetReading {
  const T = [1, 0, dx, 0, 1, dy, 0, 0, 1];
  const Hm = r.homography;
  const H2 = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => T[i * 3] * Hm[j] + T[i * 3 + 1] * Hm[3 + j] + T[i * 3 + 2] * Hm[6 + j]));
  return { ...r, corners: r.corners.map((p) => ({ x: p.x + dx, y: p.y + dy })), homography: H2 };
}
