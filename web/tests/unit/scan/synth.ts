// สร้างภาพกระดาษคำตอบจำลอง (รู้คำตอบล่วงหน้า) จากแบบกระดาษจริงของระบบ แล้วจำลองการถ่ายด้วยมือถือ
// เอียง/มุมมอง/หมุน, เงา, แสงน้อย, สัญญาณรบกวน, ภาพเบลอ, รอยฝนจาง, รอยลบไม่สะอาด, ฝนหลายช่อง
import { Resvg } from '@resvg/resvg-js';
import { answerSheetSvg } from '../../../src/modules/print/answerSheetSvg';
import { getTemplate, bubbleCenter } from '../../../src/modules/print/template';
import { apply, fromPoints, invert, type Pt } from '../../../src/modules/scan/homography';
import { sample, toGray, type Gray } from '../../../src/modules/scan/image';
import { makeRng as mulberry32 } from '../../../src/modules/assembly/rng';

export type MarkKind = 'dark' | 'normal' | 'faint' | 'residue' | 'scribble';
export interface Mark { item: number; choice: number; kind: MarkKind }

export interface SheetSpec {
  examId?: string; setNo?: number; seatNo?: number; itemCount: number; marks: Mark[]; pxPerMm?: number; seed?: number;
}

const GRAY: Record<MarkKind, [number, number]> = {
  dark: [0.08, 0.2], normal: [0.22, 0.38], faint: [0.6, 0.68], residue: [0.7, 0.78], scribble: [0.25, 0.4],
};

/** รอยดินสอ: วงรีเทาเข้มขยับเล็กน้อย + เส้นขีดสำหรับ scribble (ฝนไม่เต็มวง) */
function markSvg(t: ReturnType<typeof getTemplate>, m: Mark, rnd: () => number): string {
  const c = bubbleCenter(t, m.item, m.choice);
  const [lo, hi] = GRAY[m.kind];
  const g = Math.round((lo + (hi - lo) * rnd()) * 255);
  const col = `rgb(${g},${g},${g})`;
  const dx = (rnd() - 0.5) * 0.6, dy = (rnd() - 0.5) * 0.6;
  if (m.kind === 'scribble') {
    let d = '';
    for (let k = -1.6; k <= 1.6; k += 0.55) d += `M${c.x - 1.9 + dx} ${c.y + k + dy}L${c.x + 1.9 + dx} ${c.y + k * 0.8 + dy}`;
    return `<path d="${d}" stroke="${col}" stroke-width="0.6" stroke-linecap="round" fill="none"/>`;
  }
  const rx = 1.9 + rnd() * 0.5, ry = 1.9 + rnd() * 0.5;
  return `<ellipse cx="${c.x + dx}" cy="${c.y + dy}" rx="${rx}" ry="${ry}" fill="${col}" transform="rotate(${Math.round(rnd() * 90)} ${c.x} ${c.y})"/>`;
}

/** กระดาษคำตอบที่ฝนแล้ว แบบสแกนเรียบ (พิกเซลต่อ มม. = pxPerMm) */
export function renderSheet(s: SheetSpec): Gray {
  const t = getTemplate(1);
  const rnd = mulberry32(s.seed ?? 1);
  let svg = answerSheetSvg(t, { examId: s.examId ?? 'exam-test-0001', title: 'แบบทดสอบจำลอง', gradeShort: 'ป.5',
    itemCount: s.itemCount, setNo: s.setNo ?? 1, seatNo: s.seatNo ?? 1 });
  svg = svg.replace('</svg>', `${s.marks.map((m) => markSvg(t, m, rnd)).join('')}</svg>`);
  const px = Math.round(t.paper.width * (s.pxPerMm ?? 6));
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: px }, background: 'white', font: { loadSystemFonts: true } }).render();
  return toGray(img.pixels, img.width, img.height);
}

export interface PhotoSpec {
  outW?: number; outH?: number;
  /** สัดส่วนความสูงกระดาษต่อความสูงภาพ */
  fill?: number;
  rotateDeg?: number;
  /** มุมมองเอียง: เลื่อนมุมกระดาษแบบสุ่มไม่เกินสัดส่วนนี้ของขนาดกระดาษ */
  perspective?: number;
  /** ความสว่างสูงสุดของภาพ (1 = ปกติ, 0.35 = แสงน้อย) */
  light?: number;
  /** เงาพาดเป็นแถบ: ความมืดของเงา 0–1 */
  shadow?: number;
  /** ไล่แสงจากมุมหนึ่ง 0–1 */
  gradient?: number;
  noise?: number;
  blur?: number;
  /** กระดาษโค้ง (มม.) */
  curl?: number;
  bg?: number;
  seed?: number;
}

/** จำลองภาพถ่ายมือถือของกระดาษ */
export function photograph(sheet: Gray, p: PhotoSpec = {}): Gray {
  const rnd = mulberry32(p.seed ?? 7);
  const W = p.outW ?? 1080, Hh = p.outH ?? 1440;
  const h = (p.fill ?? 0.82) * Hh, w = h * sheet.w / sheet.h;
  const ang = ((p.rotateDeg ?? 0) * Math.PI) / 180;
  const cx = W / 2 + (rnd() - 0.5) * W * 0.04, cy = Hh / 2 + (rnd() - 0.5) * Hh * 0.04;
  const base: Pt[] = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: -w / 2, y: h / 2 }, { x: w / 2, y: h / 2 }];
  const jit = p.perspective ?? 0;
  const dst = base.map((q) => {
    const x = q.x + (rnd() - 0.5) * 2 * jit * w, y = q.y + (rnd() - 0.5) * 2 * jit * h;
    return { x: cx + x * Math.cos(ang) - y * Math.sin(ang), y: cy + x * Math.sin(ang) + y * Math.cos(ang) };
  });
  const src: Pt[] = [{ x: 0, y: 0 }, { x: sheet.w - 1, y: 0 }, { x: 0, y: sheet.h - 1 }, { x: sheet.w - 1, y: sheet.h - 1 }];
  const Hinv = invert(fromPoints(src, dst)!);
  const out = new Float32Array(W * Hh);
  const bg = p.bg ?? 70;
  const curl = (p.curl ?? 0) * (sheet.w / 148);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let s = apply(Hinv, { x, y });
    if (curl) s = { x: s.x + curl * Math.sin((Math.PI * s.y) / sheet.h), y: s.y + curl * 0.5 * Math.sin((Math.PI * s.x) / sheet.w) };
    const inside = s.x >= 0 && s.y >= 0 && s.x <= sheet.w - 1 && s.y <= sheet.h - 1;
    out[y * W + x] = inside ? sample(sheet, s.x, s.y) : bg + 25 * Math.sin(x * 0.05) * Math.cos(y * 0.031);
  }
  // แสง: ความสว่างรวม × ไล่แสง × เงา
  const light = p.light ?? 1, grad = p.gradient ?? 0, sh = p.shadow ?? 0;
  const ga = rnd() * Math.PI * 2;
  const sx0 = W * (0.3 + rnd() * 0.4);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let f = light * (1 - grad * (0.5 + 0.5 * Math.cos(ga) * (x / W - 0.5) * 2 + 0.5 * Math.sin(ga) * (y / Hh - 0.5) * 2) / 2);
    if (sh) {
      const d = (x - sx0) + (y - Hh / 2) * 0.45;            // แถบเงาเอียง (เช่น เงามือ/โทรศัพท์)
      f *= 1 - sh / (1 + Math.exp(d / 18));
    }
    out[y * W + x] *= f;
  }
  // เบลอ (box blur แนวนอน+แนวตั้ง)
  const r = Math.round(p.blur ?? 0);
  if (r > 0) for (const horiz of [true, false]) {
    const tmp = Float32Array.from(out);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = horiz ? x + k : x, yy = horiz ? y : y + k;
        if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue;
        s += tmp[yy * W + xx]; n++;
      }
      out[y * W + x] = s / n;
    }
  }
  const noise = p.noise ?? 0;
  const d = new Uint8Array(W * Hh);
  for (let i = 0; i < d.length; i++) {
    let v = out[i];
    if (noise) { const u = rnd() + rnd() + rnd() - 1.5; v += u * noise * 2; }
    d[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { w: W, h: Hh, d };
}

/** สุ่มคำตอบ itemCount ข้อ คืนรายการรอยฝน + คำตอบที่ถูกต้องตามกฎ §8.3 */
export function randomMarks(itemCount: number, seed: number, mix: { blank?: number; multi?: number; kinds?: MarkKind[] } = {}) {
  const rnd = mulberry32(seed);
  const marks: Mark[] = [];
  const expected: Array<number | null | 'multi'> = [];
  const kinds = mix.kinds ?? ['dark', 'normal', 'scribble'];
  for (let i = 1; i <= itemCount; i++) {
    const r = rnd();
    if (r < (mix.blank ?? 0.05)) { expected.push(null); continue; }
    const c = 1 + Math.floor(rnd() * 4);
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    marks.push({ item: i, choice: c, kind });
    if (r < (mix.blank ?? 0.05) + (mix.multi ?? 0.05)) {
      const c2 = ((c + Math.floor(rnd() * 3)) % 4) + 1;
      marks.push({ item: i, choice: c2, kind: kinds[Math.floor(rnd() * kinds.length)] });
      expected.push('multi');
    } else expected.push(c);
  }
  return { marks, expected };
}
