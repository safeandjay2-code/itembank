// เฟส 5: เครื่องอ่านกระดาษคำตอบ — ภาพจำลองจากแบบกระดาษจริงที่รู้คำตอบล่วงหน้า (SPEC §13 เฟส 5)
//   ภาพชัด (เอียง หมุน กลับหัว เงา แสงน้อย เบลอเล็กน้อย กระดาษโค้ง) → ต้องถูก 100% และไม่ขึ้น remark
//   ภาพกำกวม (ฝนจาง ลบไม่สะอาด) → ต้องขึ้น remark และไม่ตอบผิดแบบเงียบ ๆ
//   ภาพที่อ่านไม่ได้ → ต้องปฏิเสธ ไม่เดาคะแนน
import { describe, expect, test } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import QRCode from 'qrcode';
import { photograph, randomMarks, renderSheet, type Mark, type PhotoSpec } from './synth';
import { readPage, readSheet, type SheetReading } from '../../../src/modules/scan/omr';
import { DEFAULT_SCAN, interpret } from '../../../src/modules/scan/grade';
import { getTemplate, bubbleCenter } from '../../../src/modules/print/template';
import { answerSheetSvg } from '../../../src/modules/print/answerSheetSvg';
import { apply } from '../../../src/modules/scan/homography';
import { toGray, type Gray } from '../../../src/modules/scan/image';

const EXAM = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';   // รูปแบบ uuid จริง (QR ยาวเท่าของจริง)

const CLEAR: Record<string, PhotoSpec> = {
  'ถ่ายตรง': {},
  'เอียง 8° + มุมมอง': { rotateDeg: 8, perspective: 0.05 },
  'เอียงกลับ −10°': { rotateDeg: -10, perspective: 0.03, fill: 0.78 },
  'กลับหัว 180°': { rotateDeg: 180, perspective: 0.02 },
  'ถือแนวนอน 90°': { rotateDeg: 90, outW: 1440, outH: 1080, fill: 0.95 },
  'แสงน้อย': { light: 0.38, noise: 6, rotateDeg: -4 },
  'เงาพาด + แสงไล่': { shadow: 0.6, gradient: 0.4, rotateDeg: 3 },
  'เบลอ + noise': { blur: 2, noise: 5 },
  'กระดาษโค้ง': { curl: 1.5, perspective: 0.03 },
  'ไกล (กระดาษเล็กในภาพ)': { fill: 0.55, noise: 3 },
  'รวมหลายอย่าง': { light: 0.5, shadow: 0.5, blur: 1, noise: 4, rotateDeg: 12, perspective: 0.04, fill: 0.72 },
};

function checkClear(r: SheetReading, expected: Array<number | null | 'multi'>, itemCount: number) {
  const it = interpret(r.darkness, itemCount);
  const problems: string[] = [];
  expected.forEach((e, i) => {
    const a = it.answers[i], amb = it.ambiguous.includes(i + 1);
    if (e === 'multi') { if (a !== 'multi' && !amb) problems.push(`ข้อ ${i + 1}: ฝนหลายช่องแต่อ่านได้ ${a}`); }
    else if (a !== e) problems.push(`ข้อ ${i + 1}: คาด ${e} ได้ ${a}`);
    else if (amb) problems.push(`ข้อ ${i + 1}: ภาพชัดแต่ขึ้น remark`);
  });
  return problems;
}

describe('อ่านกระดาษคำตอบจากภาพชัด — ต้องถูก 100%', () => {
  let seed = 100;
  for (const [name, spec] of Object.entries(CLEAR)) {
    test(name, () => {
      for (const itemCount of [45, 23]) {
        seed++;
        const { marks, expected } = randomMarks(itemCount, seed, { blank: 0.08, multi: 0.06 });
        const seatNo = 1 + (seed % 40), setNo = 1 + (seed % 4);
        const sheet = renderSheet({ examId: EXAM, setNo, seatNo, itemCount, marks, seed });
        const r = readSheet(photograph(sheet, { ...spec, seed: seed * 3 }));
        expect(r.ok, `${name}: ${(r as any).message}`).toBe(true);
        if (!r.ok) return;
        expect(r.qr).toEqual({ examId: EXAM, setNo, seatNo, template: 1 });
        expect(checkClear(r, expected, itemCount)).toEqual([]);
      }
    }, 30_000);
  }
});

describe('เรขาคณิต', () => {
  test('ภาพสแกนเรียบ: ตำแหน่งมุมดำที่หาได้ตรงกับแบบกระดาษ (คลาด < 0.3 มม.)', () => {
    const ppm = 8;
    const sheet = renderSheet({ examId: EXAM, itemCount: 45, marks: [], pxPerMm: ppm });
    const r = readSheet(sheet);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = getTemplate(1);
    const k = t.corner_marks.size;
    t.corner_marks.top_left.forEach(([x, y], i) => {
      const px = ((x + k / 2) * sheet.w) / t.paper.width - 0.5, py = ((y + k / 2) * sheet.h) / t.paper.height - 0.5;
      expect(Math.hypot(r.corners[i].x - px, r.corners[i].y - py) / ppm).toBeLessThan(0.3);
    });
    // วงกลมข้อ 45 ตัวเลือก 4 (ไกลมุมที่สุด) ตกตรงตำแหน่ง
    const c = bubbleCenter(t, 45, 4);
    const p = apply(r.homography, c);
    expect(Math.hypot(p.x - (c.x * sheet.w) / t.paper.width, p.y - (c.y * sheet.h) / t.paper.height) / ppm).toBeLessThan(0.3);
    expect(r.quality.fitErrorMm).toBeLessThan(1);
  });

  test('ไม่มีรอยฝนเลย → ทุกข้อ "ไม่ฝน" ไม่มี remark', () => {
    const r = readSheet(photograph(renderSheet({ examId: EXAM, itemCount: 45, marks: [] }), { rotateDeg: 5, seed: 3 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const it = interpret(r.darkness, 45);
    expect(it.answers.every((a) => a === null)).toBe(true);
    expect(it.ambiguous).toEqual([]);
  });

  test('ฝนครบทุกข้อเป็นตัวเลือกเดียวกัน (ระดับพื้นหลังยังถูก)', () => {
    const marks: Mark[] = Array.from({ length: 45 }, (_, i) => ({ item: i + 1, choice: 3, kind: 'normal' as const }));
    const r = readSheet(photograph(renderSheet({ examId: EXAM, itemCount: 45, marks }), { seed: 4 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(interpret(r.darkness, 45).answers.every((a) => a === 3)).toBe(true);
  });
});

describe('ภาพกำกวม → remark (ไม่ตอบผิดเงียบ ๆ)', () => {
  test('ฝนจาง: ใช้คำตอบที่อ่านได้ และขึ้น remark เป็นส่วนใหญ่', () => {
    let flagged = 0, total = 0;
    for (const [i, spec] of [{}, { light: 0.45, noise: 5 }, { shadow: 0.5, rotateDeg: 4 }].entries()) {
      const marks: Mark[] = Array.from({ length: 30 }, (_, k) => ({ item: k + 1, choice: 1 + ((k * 3 + i) % 4), kind: 'faint' as const }));
      const r = readSheet(photograph(renderSheet({ examId: EXAM, itemCount: 30, marks, seed: 50 + i }), { ...spec, seed: 60 + i }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const it = interpret(r.darkness, 30);
      marks.forEach((m, k) => {
        total++;
        expect(it.answers[k], `ข้อ ${k + 1}`).toBe(m.choice);
        if (it.ambiguous.includes(k + 1)) flagged++;
      });
    }
    expect(flagged / total).toBeGreaterThan(0.6);
  });

  test('ลบไม่สะอาด + ฝนใหม่: เลือกรอยเข้ม และขึ้น remark เป็นส่วนใหญ่', () => {
    let flagged = 0, total = 0;
    for (const [i, spec] of [{}, { rotateDeg: -6, perspective: 0.03 }, { light: 0.5, noise: 4 }].entries()) {
      const marks: Mark[] = [];
      for (let k = 1; k <= 30; k++) {
        const c = 1 + ((k + i) % 4);
        marks.push({ item: k, choice: c, kind: k % 2 ? 'dark' : 'normal' }, { item: k, choice: (c % 4) + 1, kind: 'residue' });
      }
      const r = readSheet(photograph(renderSheet({ examId: EXAM, itemCount: 30, marks, seed: 70 + i }), { ...spec, seed: 80 + i }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const it = interpret(r.darkness, 30);
      for (let k = 1; k <= 30; k++) {
        total++;
        expect(it.answers[k - 1], `ข้อ ${k}`).toBe(1 + ((k + i) % 4));
        if (it.ambiguous.includes(k)) flagged++;
      }
    }
    expect(flagged / total).toBeGreaterThan(0.7);
  });
});

describe('ภาพที่อ่านไม่ได้ต้องถูกปฏิเสธ', () => {
  const blank = (w: number, h: number, v = 200): Gray => ({ w, h, d: new Uint8Array(w * h).fill(v) });

  test('ไม่มีกระดาษในภาพ → no_qr', () => {
    const g = blank(800, 1000);
    for (let i = 0; i < g.d.length; i++) g.d[i] = (i * 7919) % 255;
    expect(readSheet(g)).toMatchObject({ ok: false, reason: 'no_qr' });
  });

  test('QR อื่นที่ไม่ใช่ของระบบ → not_our_sheet', () => {
    const qr = QRCode.create('https://example.com/hello', { errorCorrectionLevel: 'M' });
    const n = qr.modules.size, m = 8;
    const g = blank((n + 8) * m, (n + 8) * m, 255);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const r = Math.floor(y / m) - 4, c = Math.floor(x / m) - 4;
      if (r >= 0 && c >= 0 && r < n && c < n && qr.modules.get(r, c)) g.d[y * g.w + x] = 0;
    }
    expect(readSheet(g)).toMatchObject({ ok: false, reason: 'not_our_sheet' });
  });

  test('แบบกระดาษรุ่นที่ไม่รู้จัก → unknown_template', () => {
    const t = { ...getTemplate(1), version: 9 };
    const svg = answerSheetSvg(t as any, { examId: EXAM, title: 'x', gradeShort: 'ป.4', itemCount: 10, setNo: 1, seatNo: 1 });
    const img = new Resvg(svg, { fitTo: { mode: 'width', value: 900 }, background: 'white' }).render();
    expect(readSheet(toGray(img.pixels, img.width, img.height))).toMatchObject({ ok: false, reason: 'unknown_template' });
  });

  test('มุมดำถูกบัง 1 มุม → corners (ไม่เดา)', () => {
    const sheet = renderSheet({ examId: EXAM, itemCount: 20, marks: [], pxPerMm: 6 });
    for (let y = sheet.h - 120; y < sheet.h; y++) for (let x = 0; x < 120; x++) sheet.d[y * sheet.w + x] = 250;
    expect(readSheet(sheet)).toMatchObject({ ok: false, reason: 'corners' });
  });

  test('มุมกระดาษหลุดกรอบภาพ → ไม่ได้ผลอ่าน', () => {
    const r = readSheet(photograph(renderSheet({ examId: EXAM, itemCount: 20, marks: [] }), { fill: 1.08, seed: 9 }));
    expect(r.ok).toBe(false);
  });

  test('มืดเกือบสนิท → ไม่ได้ผลอ่าน (ไม่เดาคะแนน)', () => {
    const { marks } = randomMarks(30, 5);
    const r = readSheet(photograph(renderSheet({ examId: EXAM, itemCount: 30, marks }), { light: 0.05, noise: 4, seed: 5 }));
    expect(r.ok).toBe(false);
  });
});

describe('สแกนเนอร์/ไฟล์ PDF', () => {
  test('A4 แนวนอนที่มีกระดาษคำตอบ 2 แผ่น (ยังไม่ตัด) → อ่านได้ทั้ง 2 แผ่น', () => {
    const a = randomMarks(40, 11), b = randomMarks(40, 12);
    const s1 = renderSheet({ examId: EXAM, seatNo: 7, setNo: 3, itemCount: 40, marks: a.marks, pxPerMm: 5 });
    const s2 = renderSheet({ examId: EXAM, seatNo: 8, setNo: 4, itemCount: 40, marks: b.marks, pxPerMm: 5 });
    const page: Gray = { w: s1.w * 2, h: s1.h, d: new Uint8Array(s1.w * 2 * s1.h) };
    for (let y = 0; y < s1.h; y++) { page.d.set(s1.d.subarray(y * s1.w, (y + 1) * s1.w), y * page.w); page.d.set(s2.d.subarray(y * s2.w, (y + 1) * s2.w), y * page.w + s1.w); }
    const rs = readPage(page);
    expect(rs.length).toBe(2);
    const ok = rs.filter((r): r is SheetReading => r.ok);
    expect(ok.map((r) => r.qr.seatNo)).toEqual([7, 8]);
    expect(checkClear(ok[0], a.expected, 40)).toEqual([]);
    expect(checkClear(ok[1], b.expected, 40)).toEqual([]);
  });

  test('ภาพสแกนความละเอียดสูง (300 dpi) อ่านได้', () => {
    const { marks, expected } = randomMarks(45, 21);
    const r = readSheet(renderSheet({ examId: EXAM, itemCount: 45, marks, pxPerMm: 11.8 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(checkClear(r, expected, 45)).toEqual([]);
  });
});

test('ค่าตั้งต้นของเกณฑ์อยู่ในช่วงที่ตั้งค่าได้ (data/settings.default.json)', async () => {
  const settings = (await import('../../../../data/settings.default.json')).default as Array<{ key: string; value: unknown }>;
  const get = (k: string) => settings.find((s) => s.key === k)?.value;
  expect(get('scan.fill_threshold')).toBe(DEFAULT_SCAN.fill);
  expect(get('scan.blank_threshold')).toBe(DEFAULT_SCAN.blank);
  expect(get('scan.multi_gap')).toBe(DEFAULT_SCAN.multiGap);
});
