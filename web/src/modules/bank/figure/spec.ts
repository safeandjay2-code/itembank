// ข้อกำหนดรูป (Figure spec) — เก็บเป็นข้อมูล JSON ในเนื้อหาข้อสอบ ไม่เก็บเป็นภาพ (SPEC §2, §5.3, §5.5)
// ตัวเลขในข้อกำหนดคือ "ข้อกำหนดของโจทย์" ตัววาดจะวาดตามสัดส่วนจริงเสมอ
// เพิ่มรูปชนิดใหม่: เพิ่ม type ที่นี่ + ตัวสร้างใน layout.ts + ฟอร์มใน forms.ts (ไม่ต้องแตะส่วนอื่น)

/** ป้ายกำกับ: true = แสดงค่าตามข้อกำหนด (เช่น "8 ซม."), ข้อความ = แสดงข้อความนั้นแทน (เช่น "x", "?"), false/ไม่ระบุ = ไม่แสดง */
export type Lbl = boolean | string | undefined;

export interface TriangleSpec {
  kind: 'triangle';
  /** SSS: ab, bc, ca · SAS: ab, bc และมุม B · ASA: มุม A, ab, มุม B */
  mode: 'SSS' | 'SAS' | 'ASA';
  ab?: number; bc?: number; ca?: number;
  A?: number; B?: number;
  unit?: string;
  names?: [string, string, string];
  show?: { ab?: Lbl; bc?: Lbl; ca?: Lbl; A?: Lbl; B?: Lbl; C?: Lbl };
  /** ด้านที่ยาวเท่ากัน (ขีดกำกับ) เช่น [["ab","ca"]] — ต้องเท่ากันจริงตามตัวเลข */
  equalSides?: string[][];
}

export interface RectangleSpec {
  kind: 'rectangle';
  w: number; h: number; unit?: string;
  names?: [string, string, string, string];
  show?: { w?: Lbl; h?: Lbl };
  diagonal?: boolean;
}

export interface SquareSpec {
  kind: 'square';
  s: number; unit?: string;
  names?: [string, string, string, string];
  show?: { s?: Lbl };
}

export interface ParallelogramSpec {
  kind: 'parallelogram';
  base: number; side: number; angle: number; unit?: string;
  names?: [string, string, string, string];
  show?: { base?: Lbl; side?: Lbl; angle?: Lbl; height?: Lbl };
}

export interface RhombusSpec {
  kind: 'rhombus';
  side: number; angle: number; unit?: string;
  names?: [string, string, string, string];
  show?: { side?: Lbl; angle?: Lbl };
}

export interface TrapezoidSpec {
  kind: 'trapezoid';
  bottom: number; top: number; height: number;
  /** ระยะเลื่อนของด้านบนจากมุมซ้ายล่าง (0 = สี่เหลี่ยมคางหมูมุมฉาก) */
  offset: number;
  unit?: string;
  names?: [string, string, string, string];
  show?: { bottom?: Lbl; top?: Lbl; height?: Lbl };
}

export interface RectilinearSpec {
  kind: 'rectilinear';
  /** เดินรอบรูปจากจุดเริ่ม: R ขวา, U ขึ้น, L ซ้าย, D ลง — ต้องกลับมาจุดเริ่ม */
  moves: Array<{ dir: 'R' | 'U' | 'L' | 'D'; len: number; label?: Lbl }>;
  unit?: string;
}

export interface AnglesSpec {
  kind: 'angles';
  /** ทิศของรังสีแต่ละเส้น (องศา ทวนเข็มจากแนวขวา) เช่น [0, 65, 180] = มุมบนเส้นตรง */
  rays: number[];
  /** มุมที่จะทำเครื่องหมาย ระหว่างรังสี from → to (ทวนเข็ม) */
  marks: Array<{ from: number; to: number; label?: Lbl }>;
  vertex?: string;
  rayNames?: string[];
}

export interface CircleSpec {
  kind: 'circle';
  radius: number; unit?: string;
  show?: 'radius' | 'diameter' | 'none';
  label?: Lbl;
  center?: string;
}

export interface CuboidSpec {
  kind: 'cuboid';
  w: number; h: number; d: number; unit?: string;
  show?: { w?: Lbl; h?: Lbl; d?: Lbl };
}

export interface BarChartSpec {
  kind: 'bar_chart';
  title?: string;
  categories: string[];
  values: number[];
  yLabel?: string;
  /** ระยะห่างเส้นตาราง (เว้นว่าง = คำนวณให้) */
  step?: number;
  showValues?: boolean;
}

export interface LineGraphSpec {
  kind: 'line_graph';
  title?: string;
  categories: string[];
  values: number[];
  yLabel?: string;
  step?: number;
  showValues?: boolean;
}

export interface PieChartSpec {
  kind: 'pie_chart';
  title?: string;
  categories: string[];
  values: number[];
  /** แสดงในชิ้นวงกลม: ร้อยละ, ค่า หรือไม่แสดง */
  labelMode?: 'percent' | 'value' | 'none';
}

export interface NumberLineSpec {
  kind: 'number_line';
  min: number; max: number; step: number;
  /** จำนวนช่องย่อยระหว่างขีดหลัก (เช่น 4 = แบ่งเป็นส่วนสี่) */
  minor?: number;
  points?: Array<{ value: number; label?: string }>;
}

export interface TableSpec {
  kind: 'table';
  header: string[];
  rows: string[][];
}

export type FigureSpec =
  | TriangleSpec | RectangleSpec | SquareSpec | ParallelogramSpec | RhombusSpec | TrapezoidSpec
  | RectilinearSpec | AnglesSpec | CircleSpec | CuboidSpec
  | BarChartSpec | LineGraphSpec | PieChartSpec | NumberLineSpec | TableSpec;

export type FigureKind = FigureSpec['kind'];

/** รูปเรขาคณิต = ต้องมีหมายเหตุมาตราส่วน; แผนภูมิ/ตาราง/เส้นจำนวน ต้องอ่านค่าได้จึงไม่ใส่หมายเหตุ */
export const GEOMETRIC_KINDS: FigureKind[] = [
  'triangle', 'rectangle', 'square', 'parallelogram', 'rhombus', 'trapezoid',
  'rectilinear', 'angles', 'circle', 'cuboid',
];

export const KIND_LABEL_TH: Record<FigureKind, string> = {
  triangle: 'สามเหลี่ยม', rectangle: 'สี่เหลี่ยมผืนผ้า', square: 'สี่เหลี่ยมจัตุรัส',
  parallelogram: 'สี่เหลี่ยมด้านขนาน', rhombus: 'สี่เหลี่ยมขนมเปียกปูน', trapezoid: 'สี่เหลี่ยมคางหมู',
  rectilinear: 'รูปเหลี่ยมมุมฉาก (รูปประกอบ)', angles: 'มุม/รังสี', circle: 'วงกลม',
  cuboid: 'ทรงสี่เหลี่ยมมุมฉาก', bar_chart: 'แผนภูมิแท่ง', line_graph: 'กราฟเส้น',
  pie_chart: 'แผนภูมิรูปวงกลม', number_line: 'เส้นจำนวน', table: 'ตาราง',
};
