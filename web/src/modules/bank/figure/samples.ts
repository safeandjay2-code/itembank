// ตัวอย่างข้อกำหนดรูปแต่ละชนิด — ใช้เป็นแม่แบบตั้งต้นในหน้าแก้ไขข้อ และใช้ในการทดสอบ
import type { FigureKind, FigureSpec } from './spec';

export const FIGURE_SAMPLES: Record<FigureKind, FigureSpec> = {
  triangle: { kind: 'triangle', mode: 'SAS', ab: 6, bc: 8, B: 90, unit: 'ซม.', show: { ab: true, bc: true } },
  rectangle: { kind: 'rectangle', w: 12, h: 5, unit: 'ซม.', show: { w: true, h: true } },
  square: { kind: 'square', s: 7, unit: 'ซม.', show: { s: true } },
  parallelogram: { kind: 'parallelogram', base: 10, side: 6, angle: 60, unit: 'ซม.', show: { base: true, side: true, angle: true } },
  rhombus: { kind: 'rhombus', side: 5, angle: 70, unit: 'ซม.', show: { side: true, angle: true } },
  trapezoid: { kind: 'trapezoid', bottom: 12, top: 7, height: 5, offset: 2, unit: 'ซม.', show: { bottom: true, top: true, height: true } },
  rectilinear: { kind: 'rectilinear', unit: 'ม.', moves: [
    { dir: 'R', len: 10, label: true }, { dir: 'U', len: 4, label: true }, { dir: 'L', len: 6, label: true },
    { dir: 'U', len: 5, label: true }, { dir: 'L', len: 4, label: true }, { dir: 'D', len: 9, label: true }] },
  angles: { kind: 'angles', rays: [0, 55, 180], marks: [{ from: 0, to: 1, label: true }, { from: 1, to: 2, label: 'x' }], vertex: 'O' },
  circle: { kind: 'circle', radius: 7, unit: 'ซม.', show: 'radius', label: true, center: 'O' },
  cuboid: { kind: 'cuboid', w: 8, h: 5, d: 6, unit: 'ซม.', show: { w: true, h: true, d: true } },
  bar_chart: { kind: 'bar_chart', title: 'จำนวนนักเรียนที่ชอบผลไม้', categories: ['มะม่วง', 'ส้ม', 'กล้วย', 'องุ่น'], values: [12, 8, 15, 5], yLabel: 'จำนวน (คน)', showValues: false },
  line_graph: { kind: 'line_graph', title: 'อุณหภูมิช่วงเช้า', categories: ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.'], values: [24, 26, 25, 28, 27], yLabel: 'องศาเซลเซียส' },
  pie_chart: { kind: 'pie_chart', title: 'รายจ่ายใน 1 เดือน', categories: ['อาหาร', 'เดินทาง', 'ออม', 'อื่น ๆ'], values: [50, 20, 25, 5], labelMode: 'percent' },
  number_line: { kind: 'number_line', min: 0, max: 2, step: 1, minor: 4, points: [{ value: 0.75, label: 'A' }, { value: 1.5, label: 'B' }] },
  table: { kind: 'table', header: ['สินค้า', 'ราคา (บาท)'], rows: [['ดินสอ', '5'], ['ยางลบ', '7'], ['สมุด', '15']] },
};
