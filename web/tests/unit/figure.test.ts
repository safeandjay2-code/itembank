import { describe, it, expect } from 'vitest';
import { renderFigure, tryRenderFigure, DEFAULT_FIGURE_NOTE } from '../../src/modules/bank/figure/svg';
import { buildScene, verifyScene, FigureError, niceStep } from '../../src/modules/bank/figure/layout';
import { FIGURE_SAMPLES } from '../../src/modules/bank/figure/samples';
import { FIGURE_FORMS, movesCodec, marksCodec, pointsCodec, rowsCodec, numberList, setPath, getPath } from '../../src/modules/bank/figure/forms';
import { GEOMETRIC_KINDS, type FigureSpec } from '../../src/modules/bank/figure/spec';

/** อ่านพิกัดจุดของ path แรกใน SVG (รูปหลัก) — ตรวจจาก "ภาพที่วาดจริง" */
function firstPathPoints(svg: string): Array<[number, number]> {
  const d = /<path d="([^"]+)"/.exec(svg)![1];
  return [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}
const len = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function angle(a: number[], v: number[], b: number[]) {
  const u = [a[0] - v[0], a[1] - v[1]], w = [b[0] - v[0], b[1] - v[1]];
  return (Math.acos((u[0] * w[0] + u[1] * w[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]))) * 180) / Math.PI;
}

describe('ตัววาดรูป: ทุกชนิดวาดได้และตรงกับข้อกำหนด', () => {
  for (const [kind, spec] of Object.entries(FIGURE_SAMPLES)) {
    it(kind, () => {
      const r = renderFigure(spec);
      expect(r.verify.problems).toEqual([]);
      expect(r.verify.ok).toBe(true);
      expect(r.svg.startsWith('<svg')).toBe(true);
      expect(r.svg.endsWith('</svg>')).toBe(true);
      // แท็กเปิด-ปิดสมดุล (XML ถูกรูปแบบเบื้องต้น)
      const opens = (r.svg.match(/<(path|text|circle|rect|svg)\b/g) ?? []).length;
      const closes = (r.svg.match(/(\/>|<\/text>|<\/svg>)/g) ?? []).length;
      expect(opens).toBe(closes);
      expect(r.width).toBeGreaterThan(50);
      expect(r.width).toBeLessThan(700);
    });
  }
});

describe('มุมและความยาวในภาพตรงกับตัวเลข', () => {
  it('สามเหลี่ยม SSS 5-7-8: อัตราส่วนด้านใน SVG ตรง', () => {
    const r = renderFigure({ kind: 'triangle', mode: 'SSS', ab: 5, bc: 8, ca: 7 });
    const [A, B, C] = firstPathPoints(r.svg);
    const k = len(A, B) / 5;
    expect(len(B, C) / k).toBeCloseTo(8, 1);
    expect(len(C, A) / k).toBeCloseTo(7, 1);
    // มุม B ของสามเหลี่ยม 5-7-8 = 60°
    expect(angle(A, B, C)).toBeCloseTo(60, 0);
  });
  it('สามเหลี่ยม SAS มุม B = 35° วาดมุมจริง 35°', () => {
    const r = renderFigure({ kind: 'triangle', mode: 'SAS', ab: 4, bc: 9, B: 35 });
    const [A, B, C] = firstPathPoints(r.svg);
    expect(angle(A, B, C)).toBeCloseTo(35, 0);
    expect(len(B, C) / len(A, B)).toBeCloseTo(9 / 4, 2);
  });
  it('สามเหลี่ยม ASA: มุม A, B ตามกำหนด และมุม C = 180 − A − B', () => {
    const r = renderFigure({ kind: 'triangle', mode: 'ASA', A: 50, ab: 6, B: 70, show: { C: true } });
    const [A, B, C] = firstPathPoints(r.svg);
    expect(angle(B, A, C)).toBeCloseTo(50, 0);
    expect(angle(A, B, C)).toBeCloseTo(70, 0);
    expect(angle(A, C, B)).toBeCloseTo(60, 0);
    expect(r.svg).toContain('>60°<');
  });
  it('มุม 69° กับ 71° ต่างกันจริงในภาพ (ไม่หลอกตา)', () => {
    const a = firstPathPoints(renderFigure({ kind: 'triangle', mode: 'SAS', ab: 5, bc: 5, B: 69 }).svg);
    const b = firstPathPoints(renderFigure({ kind: 'triangle', mode: 'SAS', ab: 5, bc: 5, B: 71 }).svg);
    expect(angle(a[0], a[1], a[2])).toBeCloseTo(69, 0);
    expect(angle(b[0], b[1], b[2])).toBeCloseTo(71, 0);
  });
  it('สี่เหลี่ยมผืนผ้า 12×5 อัตราส่วน 12:5', () => {
    const [A, B, C] = firstPathPoints(renderFigure({ kind: 'rectangle', w: 12, h: 5 }).svg);
    expect(len(A, B) / len(B, C)).toBeCloseTo(12 / 5, 2);
    expect(angle(A, B, C)).toBeCloseTo(90, 1);
  });
  it('สี่เหลี่ยมด้านขนาน มุม 60°', () => {
    const [A, B, , D] = firstPathPoints(renderFigure({ kind: 'parallelogram', base: 10, side: 6, angle: 60 }).svg);
    expect(angle(D, A, B)).toBeCloseTo(60, 0);
    expect(len(A, B) / len(A, D)).toBeCloseTo(10 / 6, 2);
  });
  it('รูปประกอบ: ทุกด้านตามสัดส่วน', () => {
    const spec = FIGURE_SAMPLES.rectilinear as any;
    const pts = firstPathPoints(renderFigure(spec).svg);
    const k = len(pts[0], pts[1]) / spec.moves[0].len;
    spec.moves.forEach((m: any, i: number) => expect(len(pts[i], pts[(i + 1) % pts.length]) / k).toBeCloseTo(m.len, 1));
  });
  it('แผนภูมิแท่ง: ความสูงแท่งเป็นสัดส่วนกับค่า', () => {
    const r = renderFigure({ kind: 'bar_chart', categories: ['ก', 'ข'], values: [10, 25] });
    const bars = [...r.svg.matchAll(/<path d="M([-\d.]+) ([-\d.]+) L[-\d.]+ ([-\d.]+) L[^"]+Z" fill="#9cc9bb"/g)]
      .map((m) => Number(m[2]) - Number(m[3]));
    expect(bars).toHaveLength(2);
    expect(bars[1] / bars[0]).toBeCloseTo(2.5, 2);
  });
  it('ตัวตรวจจับรูปผิดสัดส่วนได้จริง', () => {
    const scene = buildScene({ kind: 'rectangle', w: 10, h: 5 });
    const squash = (p: { x: number; y: number }) => ({ x: p.x, y: p.y * 1.3 });
    const v = verifyScene(scene, squash);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toMatch(/สัดส่วนไม่ตรง|มุม/);
  });
});

describe('ข้อกำหนดผิดต้องถูกปฏิเสธ', () => {
  const bad: Array<[string, FigureSpec, RegExp]> = [
    ['ด้านสร้างสามเหลี่ยมไม่ได้', { kind: 'triangle', mode: 'SSS', ab: 2, bc: 3, ca: 6 }, /ผลบวกสองด้าน/],
    ['มุมรวมเกิน 180', { kind: 'triangle', mode: 'ASA', A: 100, ab: 3, B: 90 }, /น้อยกว่า 180/],
    ['ด้านเท่าแต่ตัวเลขไม่เท่า', { kind: 'triangle', mode: 'SSS', ab: 5, bc: 6, ca: 7, equalSides: [['ab', 'ca']] }, /ตัวเลขไม่เท่ากัน/],
    ['ความยาวติดลบ', { kind: 'rectangle', w: -3, h: 2 }, /มากกว่า 0/],
    ['รูปประกอบไม่บรรจบ', { kind: 'rectilinear', moves: [{ dir: 'R', len: 4 }, { dir: 'U', len: 3 }, { dir: 'L', len: 3 }, { dir: 'D', len: 3 }] }, /ไม่บรรจบ/],
    ['รูปประกอบตัดกันเอง', { kind: 'rectilinear', moves: [{ dir: 'R', len: 4 }, { dir: 'U', len: 2 }, { dir: 'L', len: 2 }, { dir: 'D', len: 4 }, { dir: 'L', len: 2 }, { dir: 'U', len: 2 }] }, /ตัดกันเอง/],
    ['จำนวนค่าไม่ตรงรายการ', { kind: 'bar_chart', categories: ['ก', 'ข'], values: [1] }, /ไม่เท่ากัน/],
    ['จุดนอกเส้นจำนวน', { kind: 'number_line', min: 0, max: 1, step: 1, points: [{ value: 2 }] }, /นอกเส้นจำนวน/],
    ['ช่วงหารไม่ลงตัว', { kind: 'number_line', min: 0, max: 1, step: 0.3 }, /หารด้วยระยะ/],
  ];
  for (const [name, spec, re] of bad) {
    it(name, () => {
      expect(() => buildScene(spec)).toThrow(FigureError);
      expect(() => buildScene(spec)).toThrow(re);
      const t = tryRenderFigure(spec);
      expect(t.ok).toBe(false);
    });
  }
  it('ชนิดที่ไม่รู้จัก', () => {
    expect(tryRenderFigure({ kind: 'hexagon' }).ok).toBe(false);
    expect(tryRenderFigure(null).ok).toBe(false);
  });
});

describe('หมายเหตุมาตราส่วน', () => {
  it('รูปเรขาคณิตมีหมายเหตุตัวหนาสีดำ', () => {
    for (const k of GEOMETRIC_KINDS) {
      const svg = renderFigure(FIGURE_SAMPLES[k]).svg;
      expect(svg).toContain(DEFAULT_FIGURE_NOTE);
      expect(svg).toMatch(/font-weight="700" fill="#000000" data-role="figure-note"/);
    }
  });
  it('แผนภูมิ/ตาราง/เส้นจำนวนไม่ใส่หมายเหตุ (ต้องอ่านค่าตามมาตราส่วน)', () => {
    for (const k of ['bar_chart', 'line_graph', 'pie_chart', 'number_line', 'table'] as const)
      expect(renderFigure(FIGURE_SAMPLES[k]).svg).not.toContain('figure-note');
  });
  it('ใช้ข้อความหมายเหตุจากตั้งค่าได้', () => {
    expect(renderFigure(FIGURE_SAMPLES.square, { note: 'ทดสอบหมายเหตุ' }).svg).toContain('ทดสอบหมายเหตุ');
  });
});

describe('ป้ายกำกับ', () => {
  it('แสดงค่า + หน่วย, ข้อความแทนค่า, และซ่อนได้', () => {
    const svg = renderFigure({ kind: 'rectangle', w: 1250, h: 7.5, unit: 'ม.', show: { w: true, h: 'x' } }).svg;
    expect(svg).toContain('>1,250 ม.<');
    expect(svg).toContain('>x<');
    expect(svg).not.toContain('7.5');
  });
  it('มุมฉากมีเครื่องหมายอัตโนมัติ', () => {
    const scene = buildScene({ kind: 'triangle', mode: 'SSS', ab: 3, bc: 4, ca: 5 });
    expect(scene.prims.some((p) => p.t === 'right')).toBe(true);
  });
  it('escape อักขระพิเศษ', () => {
    expect(renderFigure({ kind: 'table', header: ['a<b'], rows: [['"&"']] }).svg).toContain('a&lt;b');
  });
});

describe('ฟอร์มและตัวแปลงรายการ', () => {
  it('ทุกชนิดรูปมีฟอร์ม และแม่แบบมีครบ', () => {
    expect(Object.keys(FIGURE_FORMS).sort()).toEqual(Object.keys(FIGURE_SAMPLES).sort());
  });
  it('เส้นรอบรูป แปลงไป-กลับได้', () => {
    const v = movesCodec.parse('R10 U4 L6=x U5= L4 D9') as any[];
    expect(v[2]).toEqual({ dir: 'L', len: 6, label: 'x' });
    expect(v[3].label).toBe(false);
    expect(movesCodec.format(v)).toBe('R10 U4 L6=x U5= L4 D9');
  });
  it('มุม จุด ตาราง ตัวเลข', () => {
    expect(marksCodec.parse('0-1, 1-2=x')).toEqual([{ from: 0, to: 1, label: true }, { from: 1, to: 2, label: 'x' }]);
    expect(pointsCodec.format(pointsCodec.parse('0.75=A, 1.5'))).toBe('0.75=A, 1.5');
    expect(rowsCodec.parse('ดินสอ | 5\nยางลบ|7')).toEqual([['ดินสอ', '5'], ['ยางลบ', '7']]);
    expect(numberList.parse('12, 8,15')).toEqual([12, 8, 15]);
  });
  it('setPath/getPath ไม่แก้วัตถุเดิม', () => {
    const a = { kind: 'rectangle', w: 3 };
    const b = setPath(a, 'show.w', true);
    expect(getPath(b, 'show.w')).toBe(true);
    expect((a as any).show).toBeUndefined();
    expect(getPath(setPath(b, 'show.w', undefined), 'show.w')).toBeUndefined();
  });
  it('ระยะเส้นตาราง', () => {
    expect(niceStep(15)).toBe(5);
    expect(niceStep(28)).toBe(10);
    expect(niceStep(240)).toBe(50);
  });
});
