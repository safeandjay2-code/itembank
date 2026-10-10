// เฟส 4: เอกสารพิมพ์ — เศษส่วน, แบบกระดาษคำตอบ (ตำแหน่งไม่ชนกัน), QR, ข้อมูลรายชุด, โครงสร้างไฟล์ Word (A4 สองคอลัมน์ ฟอนต์ เศษส่วนเป็นสมการ)
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeFileSync, mkdirSync } from 'node:fs';
import curriculum from '../../../data/curriculum/math_2560_terminal_p4_p6.json';
import levels from '../../../data/levels.json';
import { buildIndicators } from '../../src/data/memoryRepo';
import { splitMath, visualLength } from '../../src/modules/print/math';
import { buildPrintDoc, optionLayout } from '../../src/modules/print/model';
import { bubbleCenter, getTemplate, itemSlot, parseQrPayload, qrPayload } from '../../src/modules/print/template';
import { answerSheetSvg } from '../../src/modules/print/answerSheetSvg';
import { buildExamDocx, buildKeyDocx, toBuffer } from '../../src/modules/print/docx';
import { sampleExam } from '../../src/modules/print/sampleDoc';

const ref = {
  indicators: buildIndicators(),
  grades: curriculum.grades.map((g: any) => ({ id: g.id, nameTh: g.name_th, shortTh: g.short_th, sort: g.sort })),
  difficulties: levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper })),
};
const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const rasterize = async () => PNG_1PX;

describe('เศษส่วน', () => {
  it('แยกเศษส่วนและจำนวนคละ', () => {
    expect(splitMath('ผลบวกของ 3/4 กับ 1 1/8 เท่ากับ')).toEqual([
      { t: 'text', v: 'ผลบวกของ ' }, { t: 'frac', whole: null, num: '3', den: '4' }, { t: 'text', v: ' กับ ' },
      { t: 'frac', whole: '1', num: '1', den: '8' }, { t: 'text', v: ' เท่ากับ' }]);
    expect(splitMath('2 1/2')).toEqual([{ t: 'frac', whole: '2', num: '1', den: '2' }]);
    expect(splitMath('12 ÷ 4 = 3')).toEqual([{ t: 'text', v: '12 ÷ 4 = 3' }]);
    expect(splitMath('1/4, 1/3, 1/2').filter((s) => s.t === 'frac')).toHaveLength(3);
    expect(splitMath('1.5/2').filter((s) => s.t === 'frac')).toHaveLength(0); // ทศนิยมไม่ใช่เศษส่วน
  });
  it('ความยาวที่มองเห็น ไม่นับสระบน/ล่าง', () => {
    expect(visualLength('ที่')).toBe(1);
    expect(visualLength('7/8')).toBeLessThan(3);
  });
  it('ตัวเลือกสั้นจัด 2×2 ยาวเรียงบรรทัด', () => {
    expect(optionLayout(['7/8', '4/12', '1 1/8', '5/8'])).toBe('grid');
    expect(optionLayout(['24 ตารางเซนติเมตร', '48 ตารางเซนติเมตร', '14', '28'])).toBe('list');
  });
});

describe('แบบกระดาษคำตอบรุ่น 1', () => {
  const t = getTemplate(1);
  const boxes = [
    ...t.corner_marks.top_left.map(([x, y]) => ({ x, y, w: t.corner_marks.size, h: t.corner_marks.size, n: 'mark' })),
    { x: t.qr.x, y: t.qr.y, w: t.qr.size, h: t.qr.size, n: 'qr' },
    { x: t.header.x, y: t.header.y, w: t.header.width, h: t.header.height, n: 'header' },
    { x: t.reserved_numeric.x, y: t.reserved_numeric.y, w: t.reserved_numeric.width, h: t.reserved_numeric.height, n: 'reserved' },
    { x: t.scorer.x, y: t.scorer.y, w: t.scorer.width, h: t.scorer.height, n: 'scorer' },
  ];
  it('ความจุ 45 ข้อ เรียงลงทีละคอลัมน์', () => {
    expect(t.bubbles.capacity).toBe(45);
    expect(itemSlot(t, 1)).toEqual({ col: 0, row: 0 });
    expect(itemSlot(t, 16)).toEqual({ col: 1, row: 0 });
    expect(itemSlot(t, 45)).toEqual({ col: 2, row: 14 });
    expect(() => itemSlot(t, 46)).toThrow(/เกินความจุ/);
  });
  it('วงกลมทุกวงอยู่ในกระดาษ ไม่ชนมุมดำ QR หัวกระดาษ พื้นที่สำรอง และห่างกันพอ', () => {
    const r = t.bubbles.radius;
    const all: Array<{ x: number; y: number }> = [];
    for (let n = 1; n <= 45; n++) for (let c = 1; c <= 4; c++) all.push(bubbleCenter(t, n, c));
    for (const p of all) {
      expect(p.x - r).toBeGreaterThan(3); expect(p.x + r).toBeLessThan(t.paper.width - 3);
      for (const b of boxes) {
        const hit = p.x + r > b.x && p.x - r < b.x + b.w && p.y + r > b.y && p.y - r < b.y + b.h;
        expect(hit, `วงกลมที่ (${p.x},${p.y}) ชน ${b.n}`).toBe(false);
      }
    }
    let minGap = Infinity;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
      minGap = Math.min(minGap, Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) - 2 * r);
    expect(minGap).toBeGreaterThanOrEqual(1.5); // ช่องว่างระหว่างวงอย่างน้อย 1.5 มม.
  });
  it('มุมดำอยู่ห่างขอบกระดาษ ≥ 5 มม. (เครื่องพิมพ์พิมพ์ถึง)', () => {
    for (const [x, y] of t.corner_marks.top_left) {
      expect(x).toBeGreaterThanOrEqual(5); expect(y).toBeGreaterThanOrEqual(5);
      expect(x + t.corner_marks.size).toBeLessThanOrEqual(t.paper.width - 5);
      expect(y + t.corner_marks.size).toBeLessThanOrEqual(t.paper.height - 5);
    }
  });
  it('QR: ไม่มีเฉลยหรือรหัสข้อ อ่านกลับได้ตรง', () => {
    const d = { examId: '0b6c1f2e-6a3d-4c55-9e1a-1234567890ab', setNo: 3, seatNo: 27, template: 1 };
    const s = qrPayload(d);
    // เฟส 5: รหัสชุดแบบ uuid ย่อเป็น base32 ใน QR แบบ alphanumeric (QR รุ่น 2 แทนรุ่น 4 — โมดูลใหญ่ขึ้น อ่านง่ายขึ้น)
    expect(s).toMatch(/^IB2:[A-Z2-7]{26}:3:27:1$/);
    expect(s.length).toBeLessThanOrEqual(38);
    expect(parseQrPayload(s)).toEqual(d);
    expect(parseQrPayload('IB1|0b6c1f2e-6a3d-4c55-9e1a-1234567890ab|3|27|1')).toEqual(d);   // รูปแบบเดิมยังอ่านได้
    expect(qrPayload({ ...d, examId: 'exam-1' })).toBe('IB1|exam-1|3|27|1');
    expect(parseQrPayload('hello')).toBeNull();
    expect(parseQrPayload('IB2:AAAA:1:1:1')).toBeNull();
  });
  it('QR: uuid ↔ base32 กลับไปกลับมาได้ตรง 500 ค่า และ QR ไม่เกินรุ่น 2', async () => {
    const { uuidToB32, b32ToUuid } = await import('../../src/modules/print/template');
    const QR = (await import('qrcode')).default;
    for (let k = 0; k < 500; k++) {
      const u = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === 'y' ? 8 : 0)).toString(16).slice(-1));
      expect(b32ToUuid(uuidToB32(u))).toBe(u);
    }
    const worst = qrPayload({ examId: 'ffffffff-ffff-4fff-bfff-ffffffffffff', setNo: 10, seatNo: 60, template: 1 });
    expect(QR.create(worst, { errorCorrectionLevel: 'M' }).version).toBe(2);
  });
  it('SVG กระดาษคำตอบ: มุมดำ 4 มุม วงกลมเท่าจำนวนข้อ × 4 ไม่มีชื่อนักเรียน', () => {
    const svg = answerSheetSvg(t, { examId: 'x', title: 'สอบ', gradeShort: 'ป.5', itemCount: 17, setNo: 2, seatNo: 5 });
    expect(svg.match(/<rect x="\d+" y="\d+" width="7" height="7" fill="#000"\/>/g)).toHaveLength(4);
    expect(svg.match(/<circle [^>]*fill="none"/g)).toHaveLength(17 * 4);
    expect(svg).toContain('width="148mm" height="210mm"');
    expect(svg).toContain('ชั้น ป.5   เลขที่ 5   ชุดที่ 2');
    expect(svg).not.toMatch(/ชื่อ|นามสกุล/);
  });
});

describe('ข้อมูลเอกสารรายชุด', () => {
  const exam = sampleExam(ref);
  const doc = buildPrintDoc(exam, ref);
  it('ทุกชุดมีครบทุกข้อ ตัวเลือกตามลำดับของชุด และเฉลยชี้ตัวเลือกที่ถูก', () => {
    expect(doc.sets).toHaveLength(3);
    for (const s of doc.sets) {
      expect(s.items.map((i) => i.no)).toEqual(exam.items.map((_, k) => k + 1));
      for (const it of s.items) {
        const src = exam.items.find((x) => x.itemId === it.itemId)!;
        expect(it.options[it.key - 1]).toBe(src.content.options[src.answer - 1]);
        expect([...it.options].sort()).toEqual([...src.content.options].sort());
      }
    }
  });
  it('ข้อห้ามสลับคงลำดับเดิมทุกชุด', () => {
    const ns = exam.items.find((i) => i.noShuffle)!;
    for (const s of doc.sets) expect(s.items.find((i) => i.itemId === ns.itemId)!.options).toEqual(ns.content.options);
  });
  it('หัวกระดาษ', () => {
    expect(doc.gradeName).toBe('ประถมศึกษาปีที่ 5');
    expect(doc.durationMin).toBe(30);
  });
});

async function unzip(buf: Buffer) {
  const z = await JSZip.loadAsync(buf);
  return { z, xml: await z.file('word/document.xml')!.async('string') };
}

describe('ไฟล์ Word', () => {
  const doc = buildPrintDoc(sampleExam(ref), ref);
  it('แบบทดสอบ: A4 ไม่ใช่ Letter, สองคอลัมน์, TH Sarabun New 16pt, "ชุดที่ X", เศษส่วนเป็นสมการ, รูปครบ, ตัวเลือกตามชุด', async () => {
    for (const set of doc.sets) {
      const buf = await toBuffer(await buildExamDocx(doc, set, rasterize));
      const { z, xml } = await unzip(buf);
      const sizes = [...xml.matchAll(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/g)].map((m) => `${m[1]}x${m[2]}`);
      expect(sizes.length).toBeGreaterThan(0);
      expect(new Set(sizes)).toEqual(new Set(['11906x16838']));
      expect(xml).toMatch(/<w:cols [^>]*w:num="2"/);
      const styles = await z.file('word/styles.xml')!.async('string');
      expect(styles).toContain('w:ascii="TH Sarabun New"');
      expect(styles).toContain('w:cs="TH Sarabun New"');
      expect(styles).toMatch(/<w:sz w:val="32"\/>/);
      expect(xml).toContain('ชุดที่');
      expect(xml).toContain(`<w:t xml:space="preserve">${set.setNo}</w:t>`);
      const fracs = set.items.flatMap((i) => [i.stem, ...i.options]).reduce((a, t) => a + splitMath(t).filter((x) => x.t === 'frac').length, 0);
      expect((xml.match(/<m:f>/g) ?? []).length).toBe(fracs);
      expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(set.items.filter((i) => i.figure).length);
      // ตัวเลือกข้อที่มีตัวเลือกเป็นข้อความล้วน ต้องเรียงตามชุดนี้
      const it = set.items.find((i) => i.options.every((o) => !splitMath(o).some((x) => x.t === 'frac')) && i.layout === 'list')!;
      const pos = it.options.map((o) => xml.indexOf(`>${o}<`));
      expect(pos.every((p) => p > 0)).toBe(true);
      expect([...pos].sort((a, b) => a - b)).toEqual(pos);
      const footer = Object.keys(z.files).filter((f) => /word\/footer\d*\.xml/.test(f));
      expect(footer.length).toBeGreaterThan(0);
      expect(await z.file(footer[0])!.async('string')).toMatch(/PAGE/);
      if (process.env.WRITE_DOCX) { mkdirSync(process.env.WRITE_DOCX, { recursive: true }); writeFileSync(`${process.env.WRITE_DOCX}/exam_set${set.setNo}.docx`, buf); }
    }
  });
  it('เฉลยครู: ทุกชุด พร้อมรหัสข้อ และ A4', async () => {
    const buf = await toBuffer(buildKeyDocx(doc));
    const { xml } = await unzip(buf);
    expect(xml).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
    for (const s of doc.sets) {
      expect(xml).toContain(`ชุดที่ ${s.setNo}`);
      for (const it of s.items) { expect(xml).toContain(`>${it.no}. ตอบ ${it.key}<`); expect(xml).toContain(`>${it.itemCode}<`); }
    }
    if (process.env.WRITE_DOCX) writeFileSync(`${process.env.WRITE_DOCX}/key.docx`, buf);
  });
});
