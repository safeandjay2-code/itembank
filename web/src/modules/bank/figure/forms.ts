// คำอธิบายฟอร์มของรูปแต่ละชนิด (ครูกรอกเป็นช่อง ๆ ไม่ต้องเขียน JSON)
// ช่องที่เป็นรายการใช้ข้อความสั้น ๆ แปลงไป-กลับด้วย codec ด้านล่าง
import type { FigureKind, Lbl } from './spec';

export type FieldType = 'number' | 'text' | 'select' | 'lbl' | 'bool' | 'list';

export interface ListCodec {
  hint: string;
  parse(text: string): unknown;
  format(value: unknown): string;
}

export interface Field {
  path: string;            // เช่น 'ab' หรือ 'show.ab'
  label: string;
  type: FieldType;
  options?: Array<{ value: string; label: string }>;
  codec?: ListCodec;
  multiline?: boolean;
  /** แสดงช่องนี้เฉพาะเมื่อเงื่อนไขเป็นจริง */
  when?: (spec: any) => boolean;
}

export function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const root: any = structuredClone(obj ?? {});
  let o = root;
  keys.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
  const last = keys[keys.length - 1];
  if (value === undefined || value === '') delete o[last]; else o[last] = value;
  return root;
}

// ---------- codecs ----------
const splitList = (t: string) => t.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

export const textList: ListCodec = {
  hint: 'คั่นด้วยจุลภาค เช่น มะม่วง, ส้ม, กล้วย',
  parse: (t) => splitList(t),
  format: (v) => (Array.isArray(v) ? v.join(', ') : ''),
};

export const numberList: ListCodec = {
  hint: 'ตัวเลขคั่นด้วยจุลภาค เช่น 12, 8, 15',
  parse: (t) => splitList(t).map((s) => Number(s)),
  format: (v) => (Array.isArray(v) ? v.join(', ') : ''),
};

function lblSuffix(l: Lbl): string {
  if (l === undefined || l === true) return '';
  if (l === false) return '=';
  return `=${l}`;
}
function parseLbl(s: string | undefined): Lbl {
  if (s === undefined) return true;
  if (s === '') return false;
  return s;
}

/** ทางเดินรอบรูป: "R10 U4 L6=x D4=" — ทิศ+ความยาว, =ข้อความ ใช้แทนค่า, = ว่าง ไม่แสดงความยาว */
export const movesCodec: ListCodec = {
  hint: 'ทิศ R ขวา U ขึ้น L ซ้าย D ลง ตามด้วยความยาว เช่น R10 U4 L6 U5 L4 D9 · ต่อท้าย =x ให้แสดง x · ต่อท้าย = เพื่อซ่อนความยาว',
  parse(t) {
    return t.trim().split(/\s+/).filter(Boolean).map((tok) => {
      const m = /^([RULD])(\d+(?:\.\d+)?)(?:=(.*))?$/i.exec(tok);
      if (!m) return { dir: '?', len: NaN };
      return { dir: m[1].toUpperCase(), len: Number(m[2]), label: parseLbl(m[3]) };
    });
  },
  format(v) {
    return Array.isArray(v) ? v.map((m: any) => `${m.dir}${m.len}${lblSuffix(m.label)}`).join(' ') : '';
  },
};

/** มุมที่ทำเครื่องหมาย: "0-1, 1-2=x" (รังสีที่ 0 ถึงรังสีที่ 1 ทวนเข็ม) */
export const marksCodec: ListCodec = {
  hint: 'ลำดับรังสี (เริ่มที่ 0) จาก-ถึง ทวนเข็ม เช่น 0-1, 1-2=x · ต่อท้าย = เพื่อไม่แสดงขนาด',
  parse(t) {
    return splitList(t).map((s) => {
      const m = /^(\d+)\s*-\s*(\d+)(?:=(.*))?$/.exec(s);
      if (!m) return { from: -1, to: -1 };
      return { from: Number(m[1]), to: Number(m[2]), label: parseLbl(m[3]) };
    });
  },
  format(v) {
    return Array.isArray(v) ? v.map((m: any) => `${m.from}-${m.to}${lblSuffix(m.label)}`).join(', ') : '';
  },
};

/** จุดบนเส้นจำนวน: "0.75=A, 1.5=B" */
export const pointsCodec: ListCodec = {
  hint: 'ค่า=ชื่อจุด เช่น 0.75=A, 1.5=B',
  parse(t) {
    return splitList(t).map((s) => {
      const [v, label] = s.split('=');
      return label !== undefined ? { value: Number(v), label: label.trim() } : { value: Number(v) };
    });
  },
  format(v) {
    return Array.isArray(v) ? v.map((p: any) => (p.label ? `${p.value}=${p.label}` : `${p.value}`)).join(', ') : '';
  },
};

/** ตาราง: บรรทัดละแถว ช่องคั่นด้วย | */
export const rowsCodec: ListCodec = {
  hint: 'บรรทัดละ 1 แถว คั่นช่องด้วย | เช่น ดินสอ | 5',
  parse: (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|').map((c) => c.trim())),
  format: (v) => (Array.isArray(v) ? v.map((r: any) => (Array.isArray(r) ? r.join(' | ') : '')).join('\n') : ''),
};

export const headerCodec: ListCodec = {
  hint: 'หัวตาราง คั่นด้วย | เช่น สินค้า | ราคา (บาท)',
  parse: (t) => (t.trim() ? t.split('|').map((c) => c.trim()) : []),
  format: (v) => (Array.isArray(v) ? v.join(' | ') : ''),
};

// ---------- ฟอร์มของแต่ละชนิด ----------
const unit: Field = { path: 'unit', label: 'หน่วย', type: 'text' };
const n = (path: string, label: string, when?: Field['when']): Field => ({ path, label, type: 'number', when });
const l = (path: string, label: string): Field => ({ path, label, type: 'lbl' });

export const FIGURE_FORMS: Record<FigureKind, Field[]> = {
  triangle: [
    { path: 'mode', label: 'กำหนดด้วย', type: 'select', options: [
      { value: 'SSS', label: 'ด้าน 3 ด้าน (AB, BC, CA)' },
      { value: 'SAS', label: 'ด้าน AB, BC และมุม B' },
      { value: 'ASA', label: 'มุม A, ด้าน AB และมุม B' }] },
    n('ab', 'ด้าน AB'),
    n('bc', 'ด้าน BC', (s) => s.mode !== 'ASA'),
    n('ca', 'ด้าน CA', (s) => s.mode === 'SSS'),
    n('A', 'มุม A (องศา)', (s) => s.mode === 'ASA'),
    n('B', 'มุม B (องศา)', (s) => s.mode !== 'SSS'),
    unit,
    l('show.ab', 'ป้ายด้าน AB'), l('show.bc', 'ป้ายด้าน BC'), l('show.ca', 'ป้ายด้าน CA'),
    l('show.A', 'ป้ายมุม A'), l('show.B', 'ป้ายมุม B'), l('show.C', 'ป้ายมุม C'),
    { path: 'equalSides', label: 'ด้านที่ยาวเท่ากัน (ขีดกำกับ)', type: 'list', codec: {
      hint: 'กลุ่มคั่นด้วย ; ด้านคั่นด้วย , เช่น ab, ca',
      parse: (t) => t.split(';').map((g) => g.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)).filter((g) => g.length),
      format: (v) => (Array.isArray(v) ? v.map((g: any) => g.join(', ')).join('; ') : ''),
    } },
  ],
  rectangle: [n('w', 'ความกว้าง (ด้านล่าง)'), n('h', 'ความยาว (ด้านข้าง)'), unit,
    l('show.w', 'ป้ายด้านล่าง'), l('show.h', 'ป้ายด้านข้าง'), { path: 'diagonal', label: 'ลากเส้นทแยงมุม', type: 'bool' }],
  square: [n('s', 'ความยาวด้าน'), unit, l('show.s', 'ป้ายความยาวด้าน')],
  parallelogram: [n('base', 'ฐาน'), n('side', 'ด้านข้าง'), n('angle', 'มุมที่ฐาน (องศา)'), unit,
    l('show.base', 'ป้ายฐาน'), l('show.side', 'ป้ายด้านข้าง'), l('show.angle', 'ป้ายมุม'), l('show.height', 'เส้นสูง')],
  rhombus: [n('side', 'ความยาวด้าน'), n('angle', 'มุม (องศา)'), unit, l('show.side', 'ป้ายความยาวด้าน'), l('show.angle', 'ป้ายมุม')],
  trapezoid: [n('bottom', 'ด้านล่าง'), n('top', 'ด้านบน'), n('height', 'ความสูง'), n('offset', 'ระยะเลื่อนด้านบน (0 = มุมฉากซ้าย)'), unit,
    l('show.bottom', 'ป้ายด้านล่าง'), l('show.top', 'ป้ายด้านบน'), l('show.height', 'เส้นสูง')],
  rectilinear: [{ path: 'moves', label: 'เส้นรอบรูป', type: 'list', codec: movesCodec }, unit],
  angles: [
    { path: 'rays', label: 'ทิศของรังสี (องศา)', type: 'list', codec: { ...numberList, hint: 'องศาทวนเข็มจากแนวขวา เช่น 0, 55, 180 = มุมบนเส้นตรง' } },
    { path: 'marks', label: 'มุมที่ทำเครื่องหมาย', type: 'list', codec: marksCodec },
    { path: 'vertex', label: 'ชื่อจุดยอด', type: 'text' },
    { path: 'rayNames', label: 'ชื่อปลายรังสี', type: 'list', codec: { ...textList, hint: 'ตามลำดับรังสี เช่น A, B, C' } },
  ],
  circle: [n('radius', 'รัศมี'), unit,
    { path: 'show', label: 'แสดงเส้น', type: 'select', options: [
      { value: 'radius', label: 'รัศมี' }, { value: 'diameter', label: 'เส้นผ่านศูนย์กลาง' }, { value: 'none', label: 'ไม่แสดง' }] },
    l('label', 'ป้ายความยาว'), { path: 'center', label: 'ชื่อจุดศูนย์กลาง', type: 'text' }],
  cuboid: [n('w', 'ความกว้าง'), n('h', 'ความสูง'), n('d', 'ความลึก'), unit,
    l('show.w', 'ป้ายความกว้าง'), l('show.h', 'ป้ายความสูง'), l('show.d', 'ป้ายความลึก')],
  bar_chart: [{ path: 'title', label: 'ชื่อแผนภูมิ', type: 'text' },
    { path: 'categories', label: 'รายการ', type: 'list', codec: textList },
    { path: 'values', label: 'ค่า', type: 'list', codec: numberList },
    { path: 'yLabel', label: 'ชื่อแกนตั้ง', type: 'text' }, n('step', 'ระยะเส้นตาราง (เว้นว่าง = อัตโนมัติ)'),
    { path: 'showValues', label: 'แสดงตัวเลขบนแท่ง', type: 'bool' }],
  line_graph: [{ path: 'title', label: 'ชื่อกราฟ', type: 'text' },
    { path: 'categories', label: 'รายการ (แกนนอน)', type: 'list', codec: textList },
    { path: 'values', label: 'ค่า', type: 'list', codec: numberList },
    { path: 'yLabel', label: 'ชื่อแกนตั้ง', type: 'text' }, n('step', 'ระยะเส้นตาราง (เว้นว่าง = อัตโนมัติ)'),
    { path: 'showValues', label: 'แสดงตัวเลขที่จุด', type: 'bool' }],
  pie_chart: [{ path: 'title', label: 'ชื่อแผนภูมิ', type: 'text' },
    { path: 'categories', label: 'รายการ', type: 'list', codec: textList },
    { path: 'values', label: 'ค่า', type: 'list', codec: numberList },
    { path: 'labelMode', label: 'ตัวเลขในชิ้นวงกลม', type: 'select', options: [
      { value: 'percent', label: 'ร้อยละ' }, { value: 'value', label: 'ค่า' }, { value: 'none', label: 'ไม่แสดง' }] }],
  number_line: [n('min', 'ค่าต่ำสุด'), n('max', 'ค่าสูงสุด'), n('step', 'ระยะขีดหลัก'), n('minor', 'จำนวนช่องย่อยระหว่างขีดหลัก'),
    { path: 'points', label: 'จุดบนเส้นจำนวน', type: 'list', codec: pointsCodec }],
  table: [{ path: 'header', label: 'หัวตาราง', type: 'list', codec: headerCodec },
    { path: 'rows', label: 'แถวข้อมูล', type: 'list', codec: rowsCodec, multiline: true }],
};
