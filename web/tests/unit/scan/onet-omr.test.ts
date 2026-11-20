// ห้อง O-NET เฟส 3: ตัวอ่านกระดาษคำตอบ ON1 (SPEC-ONET §5–§6)
//   ภาพชัด (เอียง หมุน กลับหัว เงา แสงน้อย เบลอ กระดาษโค้ง) → เลขที่ ปรนัย ตัวเลข 3 หลัก รหัสชุด ถูก 100% ไม่ขึ้น remark เกิน
//   ฝนจาง / ลบไม่สะอาด / ฝนเกิน / ระบายไม่ครบ → ต้องมี remark หรือให้ครูยืนยัน — "ผิดเงียบ" = 0
//   แยก QR: กระดาษ ON1 ไม่ถูกอ่านเป็นกระดาษระบบหลัก และกลับกัน
import { describe, expect, test } from 'vitest';
import { photograph, renderSheet, type MarkKind, type PhotoSpec } from './synth';
import { ON1, randomOnet, renderOnetSheet, type OnetMark, type OnetMix, type OnetTruth } from './onetSynth';
import { readOnetSheet, readPage, readSheet, type OnetSheetReading } from '../../../src/modules/scan/omr';
import { interpretOnet, type OnetInterpretation } from '../../../src/modules/scan/onetGrade';
import { handleReadRequest } from '../../../src/modules/scan/readCore';
import { on1AllBubbles } from '../../../src/modules/print/onetTemplate';
import { makeRng } from '../../../src/modules/assembly/rng';
import type { Gray } from '../../../src/modules/scan/image';

// กล้องในแอปขอภาพ 1920×1080 (ScanPage) → ถือมือถือแนวตั้งถ่าย A4 = 1080×1920
const FRAME: PhotoSpec = { outW: 1080, outH: 1920 };

/** สัดส่วนกระดาษในภาพที่ใหญ่ที่สุดที่ยังเห็นครบทั้งแผ่น (เหมือนครูถือให้กระดาษเต็มจอ) เมื่อเอียง rot องศา */
function fitFill(p: PhotoSpec, margin = 0.92): number {
  const W = p.outW ?? 1080, H = p.outH ?? 1920;
  const a = Math.abs(((p.rotateDeg ?? 0) * Math.PI) / 180);
  const k = 210 / 297, j = 1 + 2 * (p.perspective ?? 0);
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  // ความสูงกระดาษ h: กว้างหลังหมุน = h(k·c + s), สูงหลังหมุน = h(k·s + c)
  const h = Math.min((margin * W) / ((k * c + s) * j), (margin * H) / ((k * s + c) * j));
  return h / H;
}
const shot = (p: PhotoSpec, shrink = 1): PhotoSpec => { const q = { ...FRAME, ...p }; return { ...q, fill: fitFill(q) * shrink }; };
const CLEAR: Record<string, PhotoSpec> = {
  'ถ่ายตรง': {},
  'เอียง 8° + มุมมอง': { rotateDeg: 8, perspective: 0.05 },
  'เอียงกลับ −10°': { rotateDeg: -10, perspective: 0.03 },
  'กลับหัว 180°': { rotateDeg: 180, perspective: 0.02 },
  'ถือแนวนอน 90°': { rotateDeg: 90, outW: 1920, outH: 1080 },
  'แสงน้อย': { light: 0.38, noise: 6, rotateDeg: -4 },
  'เงาพาด + แสงไล่': { shadow: 0.6, gradient: 0.4, rotateDeg: 3 },
  'เบลอ + noise': { blur: 2, noise: 5 },
  'กระดาษโค้ง': { curl: 1.5, perspective: 0.03 },
  'ไกล (กระดาษเล็กในภาพ)': { fill: 0.75, noise: 3 },
  'รวมหลายอย่าง': { light: 0.5, shadow: 0.5, blur: 1, noise: 4, rotateDeg: 12, perspective: 0.04 },
};

const SETS = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'];

/** เทียบผลตีความกับความจริง: silent = ผิดโดยไม่มี remark/ไม่ขอให้ครูยืนยัน · noisy = ขึ้น remark ทั้งที่ภาพชัด */
function compare(it: OnetInterpretation, truth: OnetTruth) {
  const silent: string[] = [], noisy: string[] = [];
  const remarkOn = (n: number) => it.remarks.some((r) => r.item === n);
  truth.answers.forEach((e, i) => {
    const n = i + 1, a = it.answers[i], item = it.items[i];
    const flagged = item.ambiguous || remarkOn(n);
    if (e === 'multi') {
      if (a !== null && !flagged) silent.push(`ข้อ ${n}: ฝนหลายช่องแต่อ่านได้ ${a}`);
      // เหมือนระบบหลัก: ฝนหลายช่องที่อ่านเป็น "ลบไม่สะอาด" (ครูต้องตรวจ) ยอมรับได้ — ไม่ใช่ผิดเงียบ
    } else if (a !== e) {
      if (!flagged) silent.push(`ข้อ ${n}: คาด ${e} ได้ ${a}`);
      else noisy.push(`ข้อ ${n}: คาด ${e} ได้ ${a} (มี remark)`);
    } else if (truth.partial.includes(n)) {
      if (!remarkOn(n)) silent.push(`ข้อ ${n}: ระบายไม่ครบแต่ไม่มี remark`);
    } else if (flagged) noisy.push(`ข้อ ${n}: ภาพชัดแต่ขึ้น remark`);
  });
  // เลขที่: บันทึกได้ทันที (ok) ต้องถูกเสมอ
  if (it.seat.status === 'ok' && it.seat.value !== truth.seat) silent.push(`เลขที่: คาด ${truth.seat} ได้ ${it.seat.value}`);
  if (truth.seat !== null && it.seat.status !== 'ok') noisy.push(`เลขที่ ${truth.seat}: ${it.seat.status}`);
  if (truth.seat === null && it.seat.status === 'ok') silent.push(`เลขที่อ่านไม่ได้ตามกฎ แต่ได้ ${it.seat.value}`);
  // รหัสชุด: เตือนอย่างเดียว แต่ต้องอ่านตรง
  if (it.bubbledSet !== truth.bubbledSet) noisy.push(`รหัสชุด: คาด ${truth.bubbledSet} ได้ ${it.bubbledSet}`);
  return { silent, noisy };
}

function readAndInterpret(g: Gray, setCode: string) {
  const r = readOnetSheet(g);
  if (!r.ok) return { r, it: null };
  return { r, it: interpretOnet(ON1, r.darkness, r.qr.setCode) };
}

describe('อ่านกระดาษ ON1 จากภาพชัด — ต้องถูก 100%', () => {
  let seed = 300;
  for (const [name, spec] of Object.entries(CLEAR)) {
    test(name, () => {
      for (let k = 0; k < 2; k++) {
        seed++;
        const setCode = SETS[seed % 6];
        const { marks, truth } = randomOnet(setCode, seed);
        const sheet = renderOnetSheet({ setCode, marks, seed });
        const { r, it } = readAndInterpret(photograph(sheet, { ...shot(spec, spec.fill ?? 1), seed: seed * 3 }), setCode);
        expect(r.ok, `${name}: ${(r as any).message}`).toBe(true);
        if (!r.ok || !it) return;
        expect(r.qr).toEqual({ setCode, template: 1 });
        const { silent, noisy } = compare(it, truth);
        expect(silent, name).toEqual([]);
        expect(noisy, name).toEqual([]);
        expect(it.answers).toHaveLength(15);
        expect(it.setMismatch).toBe(truth.bubbledSet !== String(Number(setCode.slice(1)) * 100));
      }
    }, 60_000);
  }
});

describe('ภาพสแกนเรียบ (เครื่องถ่ายเอกสาร/สแกนเนอร์)', () => {
  test('ฝนครบทุกข้อ 100% — คำตอบตรง เลขที่ตรง ไม่มี remark', () => {
    const marks: OnetMark[] = [];
    const ans = ['2', '4', '1', '3', '3', '1', '2', '4', '1', '2', '3', '034', '007', '512', '100'];
    ans.forEach((a, i) => {
      if (i < 11) marks.push({ key: `q${i + 1}:${a}`, kind: 'normal' });
      else a.split('').forEach((d, c) => marks.push({ key: `q${i + 1}:c${c}:${d}`, kind: 'dark' }));
    });
    marks.push({ key: 'seat:c0:0', kind: 'normal' }, { key: 'seat:c1:9', kind: 'normal' }, { key: 'set:300', kind: 'normal' });
    const g = renderOnetSheet({ setCode: 'S03', marks, pxPerMm: 6 });
    const { r, it } = readAndInterpret(g, 'S03');
    expect(r.ok).toBe(true);
    expect(it!.answers).toEqual(ans);
    expect(it!.seat).toMatchObject({ value: 9, status: 'ok' });
    expect(it!.bubbledSet).toBe('300');
    expect(it!.setMismatch).toBe(false);
    expect(it!.remarks).toEqual([]);
  });

  test('แผ่นว่างทั้งแผ่น → ไม่มีคำตอบ เลขที่ต้องให้ครูพิมพ์ ไม่เดา', () => {
    const { r, it } = readAndInterpret(renderOnetSheet({ setCode: 'S01', marks: [] }), 'S01');
    expect(r.ok).toBe(true);
    expect(it!.answers.every((a) => a === null)).toBe(true);
    expect(it!.seat.status).toBe('missing');
    expect(it!.seat.value).toBeNull();
    expect(it!.remarks.map((x) => x.code)).toEqual(['seat_unreadable', 'set_not_bubbled']);
  });
});

/** ทดสอบกรณีกำกวมจำนวนมาก — นับ "ผิดเงียบ" */
function ambiguousRun(label: string, n: number, mix: OnetMix, extra?: (rnd: () => number, marks: OnetMark[]) => void) {
  const rnd = makeRng(9000 + n);
  let silent: string[] = [];
  for (let k = 0; k < n; k++) {
    const setCode = SETS[k % 6];
    const { marks, truth } = randomOnet(setCode, 7000 + k * 13 + n, mix);
    extra?.(rnd, marks);
    const spec = shot({ rotateDeg: (rnd() - 0.5) * 16, perspective: rnd() * 0.04, shadow: rnd() < 0.4 ? rnd() * 0.5 : 0, noise: rnd() * 4, seed: 40 + k });
    const { r, it } = readAndInterpret(photograph(renderOnetSheet({ setCode, marks, seed: k }), spec), setCode);
    expect(r.ok, `${label} แผ่น ${k}: ${(r as any).message}`).toBe(true);
    if (!it) continue;
    silent = silent.concat(compare(it, truth).silent.map((s) => `${label} แผ่น ${k}: ${s}`));
  }
  return silent;
}

describe('กรณีกำกวม — ผิดเงียบต้องเป็น 0', () => {
  test('ฝนจางทั้งแผ่น (ดินสออ่อน) + ฝนเกิน + ระบายไม่ครบ', () => {
    expect(ambiguousRun('จาง', 8, { kinds: ['faint', 'scribble'], mcqMulti: 0.1, numPartial: 0.15, numMulti: 0.1, seatMulti: 0.1 })).toEqual([]);
  }, 120_000);

  test('รอยลบไม่สะอาดข้างคำตอบ', () => {
    const silent = ambiguousRun('ลบไม่สะอาด', 8, {}, (rnd, marks) => {
      // เพิ่มรอยลบจางที่วงข้าง ๆ ของข้อปรนัยและหลักตัวเลขบางข้อ
      const keys = new Set(marks.map((m) => m.key));
      for (const m of [...marks]) {
        if (rnd() > 0.3) continue;
        const mq = /^q(\d+):(\d)$/.exec(m.key);
        const md = /^(q\d+|seat):c(\d):(\d)$/.exec(m.key);
        const key = mq ? `q${mq[1]}:${(Number(mq[2]) % 4) + 1}` : md ? `${md[1]}:c${md[2]}:${(Number(md[3]) + 3) % 10}` : null;
        if (key && !keys.has(key)) { marks.push({ key, kind: 'residue' }); keys.add(key); }
      }
    });
    expect(silent).toEqual([]);
  }, 120_000);
});

describe('กฎการตีความ (ข้อมูลความเข้มสังเคราะห์)', () => {
  const blank = () => Object.fromEntries(on1AllBubbles(ON1).map((b) => [b.key, 0.02]));
  const fill = (d: Record<string, number>, keys: string[], v = 0.6) => { for (const k of keys) d[k] = v; return d; };
  const base = (seat: [number, number] | null, extra: string[] = []) => {
    const d = blank();
    fill(d, ['q1:1', 'q2:2', 'q3:3', 'q4:4', 'q5:1', 'q6:2', 'q7:3', 'q8:4', 'q9:1', 'q10:2', 'q11:3',
      'q12:c0:0', 'q12:c1:3', 'q12:c2:4', 'q13:c0:1', 'q13:c1:2', 'q13:c2:3', 'q14:c0:9', 'q14:c1:9', 'q14:c2:9', 'q15:c0:0', 'q15:c1:0', 'q15:c2:0', 'set:200', ...extra]);
    if (seat) fill(d, [`seat:c0:${seat[0]}`, `seat:c1:${seat[1]}`]);
    return d;
  };

  test('คำตอบรูปแบบที่ส่งให้ onet_submit: "1"–"4" และ "034"', () => {
    const it = interpretOnet(ON1, base([1, 7]), 'S02');
    expect(it.answers).toEqual(['1', '2', '3', '4', '1', '2', '3', '4', '1', '2', '3', '034', '123', '999', '000']);
    expect(it.seat).toMatchObject({ value: 17, status: 'ok', digits: [1, 7] });
    expect(it.bubbledSet).toBe('200');
    expect(it.setMismatch).toBe(false);
    expect(it.remarks).toEqual([]);
  });

  test('เลขที่ 00 → ครูต้องพิมพ์', () => {
    const it = interpretOnet(ON1, base([0, 0]), 'S02');
    expect(it.seat).toMatchObject({ value: null, status: 'missing' });
    expect(it.remarks.map((r) => r.code)).toContain('seat_zero');
  });

  test('ระบายเฉพาะหลักหน่วย → ครูต้องพิมพ์ ระบบเสนอค่า', () => {
    const d = base(null, ['seat:c1:7']);
    const it = interpretOnet(ON1, d, 'S02');
    expect(it.seat).toMatchObject({ value: null, status: 'missing', suggested: 7 });
  });

  test('เลขที่ระบายเกิน → ครูต้องพิมพ์ ไม่เดา', () => {
    const it = interpretOnet(ON1, base([2, 3], ['seat:c1:8']), 'S02');
    expect(it.seat).toMatchObject({ value: null, status: 'missing', suggested: null });
  });

  test('เลขที่จาง → ครูต้องยืนยัน', () => {
    const d = base([2, 3]);
    d['seat:c1:3'] = 0.2;
    const it = interpretOnet(ON1, d, 'S02');
    expect(it.seat).toMatchObject({ value: null, status: 'confirm', suggested: 23 });
  });

  test('ตัวเลขลืมระบาย 0 นำหน้า → ไม่ได้คะแนน + remark', () => {
    const d = base([1, 1]);
    d['q12:c0:0'] = 0.02;
    const it = interpretOnet(ON1, d, 'S02');
    expect(it.answers[11]).toBeNull();
    expect(it.remarks).toContainEqual(expect.objectContaining({ code: 'digit_blank', item: 12, col: 0 }));
  });

  test('ตัวเลขระบายเกินในคอลัมน์ → ไม่ได้คะแนน + remark', () => {
    const it = interpretOnet(ON1, base([1, 1], ['q13:c2:7']), 'S02');
    expect(it.answers[12]).toBeNull();
    expect(it.remarks).toContainEqual(expect.objectContaining({ code: 'digit_multi', item: 13, col: 2 }));
  });

  test('ปรนัยฝนหลายช่อง → null + remark multi', () => {
    const it = interpretOnet(ON1, base([1, 1], ['q5:3']), 'S02');
    expect(it.answers[4]).toBeNull();
    expect(it.remarks).toContainEqual(expect.objectContaining({ code: 'multi', item: 5 }));
  });

  test('รหัสชุด: ระบายผิด/ไม่ระบาย/เกิน → เตือนอย่างเดียว คำตอบไม่เปลี่ยน', () => {
    const ok = interpretOnet(ON1, base([1, 1]), 'S02').answers;
    const wrong = interpretOnet(ON1, base([1, 1]), 'S05');
    expect(wrong.answers).toEqual(ok);
    expect(wrong.setMismatch).toBe(true);
    expect(wrong.remarks.map((r) => r.code)).toEqual(['set_mismatch']);
    const d = base([1, 1]); d['set:200'] = 0.02;
    expect(interpretOnet(ON1, d, 'S02').remarks.map((r) => r.code)).toEqual(['set_not_bubbled']);
    expect(interpretOnet(ON1, base([1, 1], ['set:400']), 'S02').remarks.map((r) => r.code)).toEqual(['set_multi']);
  });
});

describe('แยกชนิดกระดาษ', () => {
  test('กระดาษ ON1 ในตัวอ่านระบบหลัก → onet_sheet (ไม่อ่านเป็นคลังข้อสอบ)', () => {
    const g = renderOnetSheet({ setCode: 'S01', marks: [] });
    expect(readSheet(g)).toMatchObject({ ok: false, reason: 'onet_sheet' });
    expect(readPage(g)[0]).toMatchObject({ ok: false, reason: 'onet_sheet' });
  });

  test('กระดาษระบบหลักในตัวอ่าน O-NET → not_onet_sheet', () => {
    const g = renderSheet({ itemCount: 20, marks: [] });
    expect(readOnetSheet(g)).toMatchObject({ ok: false, reason: 'not_onet_sheet' });
  });

  test('ภาพไม่มี QR → no_qr', () => {
    const g: Gray = { w: 400, h: 560, d: new Uint8Array(400 * 560).fill(230) };
    expect(readOnetSheet(g)).toMatchObject({ ok: false, reason: 'no_qr' });
  });

  test('คำขออ่านผ่าน worker โหมด onet-upload / onet-camera', () => {
    const { marks } = randomOnet('S04', 5);
    const g = photograph(renderOnetSheet({ setCode: 'S04', marks }), { ...shot({ rotateDeg: 5 }), seed: 3 });
    const rgba = new Uint8ClampedArray(g.w * g.h * 4);
    for (let i = 0; i < g.d.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g.d[i]; rgba[i * 4 + 3] = 255; }
    const up = handleReadRequest({ id: 1, rgba: rgba.slice().buffer, w: g.w, h: g.h, mode: 'onet-upload', frame: 0 });
    expect(up.results).toEqual([]);
    expect(up.onet?.[0]).toMatchObject({ ok: true, qr: { setCode: 'S04', template: 1 } });
    // กล้อง: บางเฟรมอาจหา QR ไม่เจอ (ลองขนาดเดียวต่อเฟรม) แต่ภายใน 3 เฟรมต้องเจอ
    const cams = [0, 1, 2].map((frame) => handleReadRequest({ id: 2, rgba: rgba.slice().buffer, w: g.w, h: g.h, mode: 'onet-camera', frame }).onet![0]);
    expect(cams.some((r) => r.ok)).toBe(true);
    // ระบบหลักไม่รับกระดาษนี้
    const main = handleReadRequest({ id: 3, rgba: rgba.slice().buffer, w: g.w, h: g.h, mode: 'upload', frame: 0 });
    expect(main.results[0]).toMatchObject({ ok: false, reason: 'onet_sheet' });
  });
});

// ทดสอบหนัก (ไม่รันใน CI): ONET_STRESS=200 npx vitest run tests/unit/scan/onet-omr.test.ts
//   เด็กฝนเบา: ONET_STRESS=200 ONET_STRESS_KINDS=faint,scribble npx vitest run tests/unit/scan/onet-omr.test.ts
const N = Number(process.env.ONET_STRESS ?? 0);
const KINDS = process.env.ONET_STRESS_KINDS?.split(',') as MarkKind[] | undefined;
test.skipIf(!N)('stress ON1: ภาพสุ่มเงื่อนไข — ผิดเงียบ 0', () => {
  const rnd = makeRng(2027);
  let fails = 0, silent = 0, noisy = 0;
  for (let k = 0; k < N; k++) {
    const setCode = SETS[k % 6];
    const { marks, truth } = randomOnet(setCode, 20000 + k, { kinds: KINDS });
    const spec = shot({
      rotateDeg: (rnd() - 0.5) * 30 + (rnd() < 0.15 ? 180 : 0), perspective: rnd() * 0.05,
      light: rnd() < 0.3 ? 0.35 + rnd() * 0.3 : 1, shadow: rnd() < 0.4 ? rnd() * 0.6 : 0, gradient: rnd() * 0.4,
      noise: rnd() * 6, blur: rnd() < 0.3 ? 1 + Math.floor(rnd() * 2) : 0, curl: rnd() < 0.3 ? rnd() * 1.5 : 0, seed: 5000 + k,
    }, 0.85 + rnd() * 0.15);
    const { r, it } = readAndInterpret(photograph(renderOnetSheet({ setCode, marks, seed: k }), spec), setCode);
    if (!r.ok || !it) { fails++; console.log('FAIL', k, (r as any).reason, JSON.stringify(spec)); continue; }
    const c = compare(it, truth);
    silent += c.silent.length; noisy += c.noisy.length;
    c.silent.forEach((s) => console.log('SILENT', k, s, JSON.stringify(spec)));
  }
  console.log(`ON1 STRESS ${N} แผ่น: อ่านไม่ได้ ${fails}, ผิดเงียบ ${silent}, remark/ยืนยันเกิน ${noisy}`);
  expect(silent).toBe(0);
}, 3_600_000);

export type { OnetSheetReading };
