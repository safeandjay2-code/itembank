// ห้อง O-NET เฟส 2: แบบกระดาษคำตอบ ON1 (SPEC-ONET §5)
//   - QR ทุกชุด (S01–S06) ถอดได้ตรง ON1:S0x:1 จากภาพที่วาดจริง · ไม่มีเลขที่/เฉลยใน QR
//   - วงกลมทุกวงอยู่ในกระดาษ ไม่ซ้อนกัน ไม่ทับมุมดำ/QR · จำนวนวงตรงสเปก
//   - ตำแหน่งจากฟังก์ชันแบบกระดาษตรงกับภาพที่วาด (ฝนตรงตำแหน่ง → พิกเซลมืด · วงว่าง → สว่าง)
//   - QR แบบ ON1 ไม่ถูกอ่านเป็นกระดาษระบบหลัก (IB1/IB2) และกลับกัน
import { describe, expect, test } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import jsQR from 'jsqr';
import { onetSheetSvg } from '../../src/modules/print/onetSheetSvg';
import {
  getOnetTemplate, on1AllBubbles, on1CornerCenters, on1DigitCenter, on1McqCenter, on1SetCodeCenter,
  onetQrPayload, parseOnetQrPayload, setCodeNumber,
} from '../../src/modules/print/onetTemplate';
import { parseQrPayload, qrPayload } from '../../src/modules/print/template';

const t = getOnetTemplate(1);
const PX = 6; // พิกเซลต่อ มม.

function render(svg: string) {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: t.paper.width * PX }, background: 'white', font: { loadSystemFonts: true } }).render();
  return { w: img.width, h: img.height, rgba: new Uint8ClampedArray(img.pixels) };
}
const sheet = (code: string) => onetSheetSvg(t, { setCode: code, subtitle: `ชุดติว O-NET คณิตศาสตร์ ป.6 · ชุดที่ ${Number(code.slice(1))}` });

/** ความมืดเฉลี่ย (0–1) ในวงรัศมี r มม. รอบจุด */
function darkness(img: ReturnType<typeof render>, x: number, y: number, r: number) {
  let s = 0, n = 0;
  const R = r * PX;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const px = Math.round(x * PX + dx), py = Math.round(y * PX + dy);
      const i = (py * img.w + px) * 4;
      s += 1 - (img.rgba[i] + img.rgba[i + 1] + img.rgba[i + 2]) / 765; n++;
    }
  return s / n;
}

describe('แบบกระดาษ ON1', () => {
  test('ขนาด A4 แนวตั้ง · มุมดำ 4 มุม · รุ่น 1', () => {
    expect(t.paper).toMatchObject({ size: 'A4', width: 210, height: 297 });
    expect(t.corner_marks.top_left).toHaveLength(4);
    const svg = sheet('S01');
    expect(svg).toContain('viewBox="0 0 210 297"');
    expect(svg).toContain('width="210mm" height="297mm"');
    expect(svg).toContain('Created by Teacher Worawut Laowang');
    expect(svg).toContain('รหัสวิชา 64 คณิตศาสตร์');
  });

  test('จำนวนวง: รหัสชุด 6 + ปรนัย 11×4 + เลขที่ 2×10 + ตอบตัวเลข 4×3×10', () => {
    const all = on1AllBubbles(t);
    expect(all.filter((b) => b.key.startsWith('set:'))).toHaveLength(6);
    expect(all.filter((b) => /^q([1-9]|1[01]):[1-4]$/.test(b.key))).toHaveLength(44);
    expect(all.filter((b) => b.key.startsWith('seat:'))).toHaveLength(20);
    expect(all.filter((b) => /^q1[2-5]:c/.test(b.key))).toHaveLength(120);
    expect(all).toHaveLength(6 + 44 + 20 + 120);
    expect(new Set(all.map((b) => b.key)).size).toBe(all.length);
  });

  test('วงกลมไม่ซ้อนกัน อยู่ในกระดาษ ไม่ทับมุมดำหรือ QR', () => {
    const all = on1AllBubbles(t);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
        expect(d, `${a.key} ชน ${b.key}`).toBeGreaterThan(a.r + b.r + 0.8);
      }
    const k = t.corner_marks.size, q = t.qr;
    for (const b of all) {
      expect(b.p.x - b.r).toBeGreaterThan(18);
      expect(b.p.x + b.r).toBeLessThan(192);
      expect(b.p.y - b.r).toBeGreaterThan(18);
      expect(b.p.y + b.r).toBeLessThan(279);
      for (const [x, y] of t.corner_marks.top_left) {
        const inside = b.p.x + b.r > x - 3 && b.p.x - b.r < x + k + 3 && b.p.y + b.r > y - 3 && b.p.y - b.r < y + k + 3;
        expect(inside, `${b.key} ใกล้มุมดำ`).toBe(false);
      }
      const inQr = b.p.x + b.r > q.x && b.p.x - b.r < q.x + q.size && b.p.y + b.r > q.y && b.p.y - b.r < q.y + q.size;
      expect(inQr, `${b.key} ทับ QR`).toBe(false);
    }
    expect(on1CornerCenters(t)).toEqual([{ x: 13.5, y: 13.5 }, { x: 196.5, y: 13.5 }, { x: 13.5, y: 283.5 }, { x: 196.5, y: 283.5 }]);
  });

  test('ลำดับข้อปรนัยเรียงลงทีละคอลัมน์ 1–4 · 5–8 · 9–11 เหมือนกระดาษจริง', () => {
    expect(on1McqCenter(t, 1, 1).x).toBe(on1McqCenter(t, 4, 1).x);
    expect(on1McqCenter(t, 5, 1).x).toBeGreaterThan(on1McqCenter(t, 4, 1).x);
    expect(on1McqCenter(t, 9, 1).y).toBe(on1McqCenter(t, 1, 1).y);
    expect(on1McqCenter(t, 11, 1).y).toBe(on1McqCenter(t, 3, 1).y);
    expect(() => on1McqCenter(t, 12, 1)).toThrow();
    expect(() => on1McqCenter(t, 1, 5)).toThrow();
    // ตอบตัวเลข: วง 0 อยู่บนสุด เรียงลง · หลักร้อยอยู่ซ้าย
    expect(on1DigitCenter(t, 12, 0, 9).y).toBeGreaterThan(on1DigitCenter(t, 12, 0, 0).y);
    expect(on1DigitCenter(t, 12, 2, 0).x).toBeGreaterThan(on1DigitCenter(t, 12, 0, 0).x);
    expect(() => on1DigitCenter(t, 'seat', 2, 0)).toThrow();
    expect(() => on1DigitCenter(t, 11, 0, 0)).toThrow();
    expect(setCodeNumber('S04')).toBe(400);
  });

  test('QR: รูปแบบ ON1:S0x:รุ่น ไม่ปนกับระบบหลัก', () => {
    expect(onetQrPayload({ setCode: 'S03', template: 1 })).toBe('ON1:S03:1');
    expect(parseOnetQrPayload('ON1:S03:1')).toEqual({ setCode: 'S03', template: 1 });
    expect(parseOnetQrPayload(' ON1:S03:1 ')).toEqual({ setCode: 'S03', template: 1 });
    expect(parseOnetQrPayload('ON1:S03:1:17')).toBeNull();      // ไม่มีเลขที่ใน QR
    expect(parseQrPayload('ON1:S03:1')).toBeNull();             // ตัวอ่านระบบหลักไม่รับ
    expect(parseOnetQrPayload(qrPayload({ examId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', setNo: 1, seatNo: 3, template: 1 }))).toBeNull();
    expect(() => onetQrPayload({ setCode: 's1', template: 1 })).toThrow();
  });

  test.each(['S01', 'S02', 'S03', 'S04', 'S05', 'S06'])('ถอด QR จากภาพที่วาดได้ตรง: %s', (code) => {
    const img = render(sheet(code));
    expect(img.w).toBe(210 * PX);
    expect(Math.abs(img.h - 297 * PX)).toBeLessThanOrEqual(1);
    const r = jsQR(img.rgba, img.w, img.h);
    expect(r?.data).toBe(`ON1:${code}:1`);
    // มุมดำทึบ
    for (const c of on1CornerCenters(t)) expect(darkness(img, c.x, c.y, 2.5)).toBeGreaterThan(0.95);
  });

  test('ตำแหน่งจากแบบกระดาษตรงกับภาพ: ฝนตรงวง → มืด · วงว่าง → สว่าง', () => {
    const fills = [
      on1SetCodeCenter(t, 2), on1McqCenter(t, 1, 3), on1McqCenter(t, 7, 1), on1McqCenter(t, 11, 4),
      on1DigitCenter(t, 'seat', 0, 0), on1DigitCenter(t, 'seat', 1, 7),
      on1DigitCenter(t, 12, 0, 0), on1DigitCenter(t, 12, 1, 3), on1DigitCenter(t, 12, 2, 4), on1DigitCenter(t, 15, 2, 9),
    ];
    const svg = sheet('S01').replace('</svg>', `${fills.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2" fill="#222"/>`).join('')}</svg>`);
    const img = render(svg);
    for (const p of fills) expect(darkness(img, p.x, p.y, 1.4)).toBeGreaterThan(0.75);
    const key = (p: { x: number; y: number }) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    const filled = new Set(fills.map(key));
    for (const b of on1AllBubbles(t)) {
      if (filled.has(key(b.p))) continue;
      // วงว่าง: มีแค่เส้นขอบบาง + ตัวเลขสีเทาจาง
      expect(darkness(img, b.p.x, b.p.y, b.r * 0.8), b.key).toBeLessThan(0.25);
    }
  });
});
