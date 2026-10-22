import type { FigureSpec } from '../modules/bank/figure/spec';
import type { QualityFlag } from '../modules/calibration/calibrate';
// ชนิดข้อมูลหลักของระบบ — ตรงกับตารางใน supabase/migrations
export type Role = 'owner' | 'admin' | 'teacher';

export interface Profile {
  id: string;
  displayName: string | null;
  role: Role;
}

export interface Grade {
  id: string;        // 'P4'
  nameTh: string;
  shortTh: string;   // 'ป.4'
  sort: number;
}

export interface Indicator {
  id: string;
  subjectId: string;
  gradeId: string;
  code: string;      // 'ค 1.1 ป.4/2'
  text: string;
  sort: number;
  assessmentNote: string | null;
}

export interface DifficultyLevel {
  id: number;
  key: string;       // 'easy' | 'medium' | 'hard' | 'challenge' (เป็นข้อมูล ไม่ fix ในโค้ด)
  nameTh: string;
  pLower: number;
  pUpper: number;
}

export interface CoverageCell {
  indicatorId: string;
  difficultyId: number;
  ready: number;
  draft: number;
  needsFix: number;
}

export interface Settings {
  [key: string]: unknown;
}

// ---------- คลังข้อสอบ (เฟส 2) ----------

export type ItemStatus = 'draft' | 'reviewed' | 'active' | 'needs_fix' | 'retired';

export const STATUS_TH: Record<ItemStatus, string> = {
  draft: 'ร่าง', reviewed: 'ตรวจแล้ว', active: 'ใช้งาน', needs_fix: 'ต้องแก้', retired: 'เลิกใช้',
};

export interface CognitiveLevel { id: number; key: string; nameTh: string }

/** เนื้อหาข้อสอบ 1 เวอร์ชัน (เก็บเป็น JSON ในฐานข้อมูล — ชื่อฟิลด์ตรงกับ item_versions.content) */
export interface ItemContent {
  stem: string;
  options: string[];
  figure: FigureSpec | null;
  explanation: string;
  /** เหตุผลของตัวลวงแต่ละตัว (ความเข้าใจผิดที่ตัวลวงสะท้อน) — ตำแหน่งเฉลยเป็น null */
  distractor_rationale: Array<string | null>;
  /** นิพจน์คำนวณเฉลยซ้ำ เช่น "3/4 + 1/8" (ไม่บังคับ) */
  check?: string | null;
}

export interface ItemAnswer { choice: number }

export interface QaIssue { code: string; message: string }
export interface QaReport {
  passed: boolean;
  errors: QaIssue[];
  warnings: QaIssue[];
  checkedAt: string;
  checker: number;
}

export interface ItemSummary {
  id: string;
  itemCode: string;
  indicatorId: string;
  gradeId: string;
  itemType: string;
  cognitiveLevel: number;
  estDifficulty: number;
  currentDifficulty: number;
  status: ItemStatus;
  currentVersion: number;
  noShuffle: boolean;
  isSample: boolean;
  tags: string[];
  subtopic: string | null;
  stem: string;
  hasFigure: boolean;
  qaPassed: boolean | null;
  n: number;
  p: number | null;
  r: number | null;
  updatedAt: string;
  /** ป้ายคุณภาพจากวงจรปรับความยาก (เฟส 7): r ต่ำ / r ติดลบ */
  qualityFlag: QualityFlag | null;
  /** สถิติที่ใช้ปรับความยาก (เวอร์ชันปัจจุบัน ชั้นของตัวชี้วัด) */
  calibN: number;
  calibP: number | null;
  calibR: number | null;
}

export interface ItemVersion {
  version: number;
  content: ItemContent;
  answer: ItemAnswer;
  qa: QaReport | null;
  changeNote: string | null;
  createdAt: string;
}

export interface ItemEvent { type: string; payload: Record<string, unknown>; at: string }

export interface ItemDetail extends ItemSummary {
  versions: ItemVersion[];
  events: ItemEvent[];
  usedInExams: number;
}

/** ข้อมูลที่ผู้ใช้แก้ในหน้าแก้ไขข้อ */
export interface ItemDraft {
  indicatorId: string;
  itemType: string;
  cognitiveLevel: number;
  estDifficulty: number;
  noShuffle: boolean;
  tags: string[];
  subtopic: string | null;
  content: ItemContent;
  answer: ItemAnswer;
}

export type SaveMode = 'new' | 'minor' | 'major';

export interface SaveItemInput {
  id?: string;
  draft: ItemDraft;
  mode: SaveMode;
  changeNote?: string | null;
  qa: QaReport;
}

export interface ItemFilter {
  gradeId?: string;
  indicatorId?: string;
  difficulty?: number;
  status?: ItemStatus;
  cognitive?: number;
  q?: string;
  /** ป้ายคุณภาพ: 'any' = มีป้ายใดก็ได้ */
  flag?: QualityFlag | 'any';
  includeSample?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ItemPage { items: ItemSummary[]; total: number }

export interface ImportReport {
  dryRun: boolean;
  inserted: number;
  skipped: Array<{ index: number; itemCode: string; reason: string }>;
  errors: Array<{ index: number; itemCode: string | null; message: string }>;
}

/** รูปแบบไฟล์สำรองคลัง (มาตรฐานเปิด SPEC §3.10) */
export interface BankExport {
  format: 'itembank.bank.v1';
  exported_at: string;
  subject_id: string;
  item_count: number;
  items: Array<Record<string, unknown>>;
}

// ---------- ประกอบชุดข้อสอบ (เฟส 3) ----------

/** ข้อที่สุ่มเข้าชุดได้ — ข้อมูลย่อสำหรับอัลกอริทึม (ไม่มีโจทย์/ตัวเลือก) */
export interface PoolItem {
  id: string;
  itemCode: string;
  indicatorId: string;
  difficulty: number;
  version: number;
  /** n สะสมของเวอร์ชันปัจจุบัน */
  n: number;
  noShuffle: boolean;
  /** ตำแหน่งเฉลยในลำดับต้นฉบับ 1–4 */
  answer: number;
  isSample: boolean;
}

export interface AssemblyRow { indicatorId: string; difficulty: number; count: number }

export interface Notice { code: string; message: string }

/** สิ่งที่ส่งให้ฐานข้อมูลบันทึก (exam_create) — ฐานข้อมูลตรวจกฎซ้ำทั้งหมด */
export interface ExamCreateInput {
  title: string;
  subjectId: string;
  gradeId: string;
  setCount: number;
  studentCount: number;
  rows: AssemblyRow[];
  /** ลำดับมาตรฐาน (ก่อนสลับ) */
  items: Array<{ itemId: string; version: number; basePosition: number }>;
  sets: Array<{ setNo: number; entries: Array<{ itemId: string; optionOrder: number[] }> }>;
  build: { algorithm: string; seed: number; warnings: Notice[]; infos: Notice[]; anchorCount: number; anchorTarget: number };
  /** One Stop: ผูกห้อง + ประเภทการสอบ (ไม่ส่ง = ชุดฝึกแบบเดิม) */
  link?: ExamLink;
}

// ---------- One Stop: ประเภทการสอบ (SPEC-OneStop §4) ----------
export type ExamPurpose = 'collect' | 'final' | 'practice';
export const EXAM_PURPOSE_TH: Record<ExamPurpose, string> = { collect: 'เก็บคะแนน', final: 'ปลายภาค', practice: 'ฝึก/วินิจฉัย' };
export interface ExamLink {
  /** null = ไม่ผูกห้อง (ได้เฉพาะชุดฝึก) */
  classroomId: string | null;
  purpose: ExamPurpose;
  /** สอบซ่อม/สอบซ้ำของชุดไหน (ห้องเดียวกัน ประเภทเดียวกัน) */
  retakeOf: string | null;
}

export type ExamStatus = 'draft' | 'open' | 'closed' | 'expired';
export const EXAM_STATUS_TH: Record<ExamStatus, string> = { draft: 'สร้างแล้ว', open: 'กำลังสอบ', closed: 'ปิดแล้ว', expired: 'หมดอายุ' };

export interface ExamSummary {
  id: string;
  title: string;
  gradeId: string;
  itemCount: number;
  setCount: number;
  studentCount: number;
  status: ExamStatus;
  createdAt: string;
  /** เวลาสอบ (นาที) สำหรับหัวกระดาษ — null = ยังไม่กำหนด */
  durationMin: number | null;
  /** วันที่ข้อมูลรายเลขที่จะถูกลบอัตโนมัติ (นับจากวันเริ่มตรวจ) — null = ยังไม่เริ่มตรวจ/ปิดแล้ว */
  expiresAt: string | null;
  closedAt: string | null;
  /** One Stop: ห้องที่ผูก (null = ไม่ผูก) · ประเภทการสอบ · สอบซ่อมของชุดไหน */
  classroomId: string | null;
  purpose: ExamPurpose;
  retakeOf: string | null;
}

export interface ExamItemDetail {
  itemId: string;
  itemCode: string;
  version: number;
  basePosition: number;
  indicatorId: string;
  difficulty: number;
  isAnchor: boolean;
  noShuffle: boolean;
  n: number;
  content: ItemContent;
  answer: number;
}

export interface ExamDetail extends ExamSummary {
  rows: AssemblyRow[];
  build: ExamCreateInput['build'] | null;
  items: ExamItemDetail[];
  /** ต่อชุด: ลำดับข้อ + ลำดับตัวเลือก + เฉลยที่แสดง (1–4) */
  sets: Array<{ setNo: number; entries: Array<{ position: number; itemId: string; optionOrder: number[]; key: number }> }>;
  seats: Array<{ seatNo: number; setNo: number }>;
  hasResponses: boolean;
  /** รุ่นแบบกระดาษคำตอบ (QR บอกรุ่นนี้) */
  templateVersion: number;
  openedAt: string | null;
  /** ผลสรุประดับห้องที่เก็บไว้หลังปิดชุด/หมดอายุ (ไม่มีข้อมูลรายเลขที่) */
  closedSummary: ClosedSummary | null;
  /** สถิติรายข้อที่ชุดนี้บันทึกเข้าคลังตอนปิดชุด */
  roundStats: RoundStat[];
  /** One Stop: จำนวนเลขที่ที่มีคะแนนจากชุดนี้อยู่ในสมุดคะแนน (ลบชุด = คะแนนเหล่านี้หาย) */
  scoredSeats: number;
}

// ---------- วิเคราะห์และปิดชุด (เฟส 6) ----------

/** สถิติรายข้อ 1 รอบสอบที่เก็บในคลัง (item_stat_rounds) — ค่ารวม ไม่ระบุตัวนักเรียน */
export interface RoundStat {
  itemId: string;
  version: number;
  n: number;
  nCorrect: number;
  r: number | null;
  /** จำนวนผู้เลือกแต่ละตัวเลือกต้นฉบับ {"1":…,"2":…,"3":…,"4":…,"blank":…,"multi":…} */
  optionCounts: Record<string, number>;
}

/** ผลสรุประดับห้องตอนปิดชุด (exams.closed_summary) */
export interface ClosedSummary {
  n: number;
  studentCount: number;
  itemCount: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  meanPercent: number | null;
  histogram: number[];
  passRatio: number;
  indicators: Array<{ indicatorId: string; itemCount: number; passCount: number; meanRatio: number | null }>;
  itemsRecorded: number;
  responsesDeleted: number;
  finalizedAs: 'closed' | 'expired';
  finalizedAt: string;
}

// ---------- ตรวจด้วยกล้อง (เฟส 5) ----------

/** คำตอบ 1 ข้อ: ตัวเลือก 1–4 | null (ไม่ฝน) | 'multi' (ฝนหลายช่อง = 0 คะแนน) */
export type ScanAnswer = 1 | 2 | 3 | 4 | null | 'multi';

export type ScanFlag =
  | { type: 'ambiguous'; positions: number[]; resolved: boolean }
  | { type: 'wrong_set'; suggested_set: number; score_alt: number; resolved: boolean };

export type ScanSource = 'camera' | 'upload' | 'manual';

export interface ScanResponse {
  seatNo: number;
  /** ชุดที่ใช้ตรวจ (ปกติ = ชุดของเลขที่ · เปลี่ยนได้เมื่อครูยืนยันว่าแจกผิดชุด) */
  setNo: number;
  answers: ScanAnswer[];
  /** คำนวณที่ฐานข้อมูล */
  score: number;
  flags: ScanFlag[];
  source: ScanSource;
  scannedAt: string;
}

export interface ScanSaveInput {
  examId: string;
  seatNo: number;
  setNo: number;
  answers: ScanAnswer[];
  /** ลำดับข้อ (เริ่ม 1) ที่เครื่องอ่านไม่แน่ใจ */
  ambiguous: number[];
  source: ScanSource;
  /** true = เขียนทับผลเดิมของเลขที่นี้ */
  replace: boolean;
}

export interface ScanSaveResult {
  /** saved = ใหม่ · replaced = เขียนทับ · unchanged = สแกนซ้ำผลเดิม · exists = มีผลเดิมที่ต่างกัน (ยังไม่เขียนทับ) */
  status: 'saved' | 'replaced' | 'unchanged' | 'exists';
  response: ScanResponse;
  /** เมื่อ status = exists: คะแนนของผลใหม่ที่ยังไม่บันทึก */
  newScore?: number;
}

// ---------- สมุดคะแนน One Stop (ตาราง gb_* — migration 0011) ----------

export type GbColumnKind = 'indicator' | 'final' | 'other';
export type GbRounding = 'int' | '1dp';
export type GbAggregation = 'sum' | 'mean';
export type GbRetakePolicy = 'max' | 'latest' | 'mean' | 'manual';
export type GbAbsentPolicy = 'zero' | 'skip';

/** ตั้งค่าการคิดคะแนนที่ทับค่าเริ่มต้น gradebook.* เฉพาะห้อง (ไม่มีคีย์ = ใช้ค่าเริ่มต้นของระบบ) */
export interface GbSettings {
  rounding?: GbRounding;
  aggregation?: GbAggregation;
  retake_policy?: GbRetakePolicy;
  absent_policy?: GbAbsentPolicy;
  show_other_columns?: boolean;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  gradeId: string;
  academicYear: number;   // พ.ศ.
  term: number;
  studentCount: number;
  status: 'open' | 'closed';
  createdAt: string;
  closedAt: string | null;
  /** จำนวนช่องที่ไม่ใช่ปลายภาค */
  columnCount: number;
  examCount: number;
}

export interface GbColumn {
  id: number;
  kind: GbColumnKind;
  indicatorId: string | null;
  label: string | null;
  /** null = ยังไม่ตั้งคะแนนเต็ม */
  maxScore: number | null;
  sort: number;
}

/** ผลสรุประดับห้องตอนปิดเทอม (gb_classrooms.closed_summary) — ไม่มีข้อมูลรายเลขที่ */
export interface ClassroomCloseSummary {
  seatCount: number;
  columns: Array<{
    kind: GbColumnKind; indicatorId: string | null; label: string | null; maxScore: number | null; collected: boolean;
    mean: number | null; min: number | null; max: number | null;
  }>;
  totalMean: number | null;
  /** ชุดที่ยังเปิดอยู่และถูกปิดพร้อมเทอม */
  examsClosed: number;
  attemptsDeleted: number;
  overridesDeleted: number;
  closedAt: string;
}

export interface ClassroomDetail extends ClassroomSummary {
  subjectId: string;
  settings: GbSettings;
  /** มีค่าเมื่อปิดเทอมแล้ว */
  closedSummary: ClassroomCloseSummary | null;
  /** เรียงตามแผนการสอน (sort) · ช่องปลายภาคอยู่ท้ายเสมอ */
  columns: GbColumn[];
}

export interface ClassroomCreateInput {
  gradeId: string;
  academicYear: number;
  term: number;
  name: string;
  studentCount: number;
  finalMax: number | null;
  /** ตามลำดับแผนการสอน */
  indicators: Array<{ indicatorId: string; maxScore: number | null }>;
  settings?: GbSettings;
}

export interface ClassroomUpdateInput {
  name?: string;
  studentCount?: number;
  /** รวมกับของเดิม · ค่า null = กลับไปใช้ค่าเริ่มต้นของระบบ */
  settings?: { [K in keyof GbSettings]?: GbSettings[K] | null };
}

// ---------- สมุดคะแนนทั้งห้อง (gb_sheet — One Stop เฟส 4) ----------

export type GbOverrideReason = 'pass' | 'manual';

/** คะแนนจริงของ 1 เลขที่ × 1 ตัวชี้วัด × 1 ชุด (ตาราง gb_attempts) */
export interface GbAttempt { examId: string; seatNo: number; indicatorId: string; correct: number; total: number }
export interface GbRetakeChoice { rootExamId: string; seatNo: number; chosenExamId: string }

export interface GbSheetGroup {
  /** ชุดแรกของกลุ่ม (ชุดเดิม + สอบซ่อมของมัน) */
  root: string;
  /** จำนวนข้อของเป้าหมายนี้ในกลุ่ม (ชุดที่มากที่สุด) */
  itemTotal: number;
  /** ชุดในกลุ่มที่มีผลสอบแล้ว */
  exams: string[];
}

export interface GbSheetColumn {
  id: number;
  kind: GbColumnKind;
  indicatorId: string | null;
  /** รหัสเต็ม 'ค 1.1 ป.4/2' · standardCode = แถว 1 ของชีท 'ค 1.1' · indicatorCode = แถว 2 'ป.4/2' */
  code: string | null;
  standardCode: string | null;
  indicatorCode: string | null;
  text: string | null;
  label: string | null;
  maxScore: number | null;
  sort: number;
  /** มีผลสอบลงช่องนี้แล้วอย่างน้อย 1 กลุ่ม */
  collected: boolean;
  groups: GbSheetGroup[];
}

export interface GbSheetCell {
  columnId: number;
  /** คะแนนดิบสะสม (ถูก/เต็ม) หลังเลือกครั้งที่นับของสอบซ่อม — null = ยังไม่มีผล */
  rawCorrect: number | null;
  rawTotal: number | null;
  /** คะแนนจริงที่แปลงตามคะแนนเต็ม (ยังไม่ปัด) — null = ยังไม่มีผล/ยังไม่ตั้งคะแนนเต็ม */
  real: number | null;
  /** คะแนนที่ครูปรับ (null = ไม่ได้ปรับ) */
  adjusted: number | null;
  reason: GbOverrideReason | null;
  /** คะแนนที่ลงชีท = ปรับ (ถ้ามี) ไม่งั้นจริง ปัดตามการตั้งค่า */
  value: number | null;
  /** กลุ่มการสอบที่เลขที่นี้ขาดสอบ (root id) */
  missing: string[];
}

export interface GbSheetRow {
  seatNo: number;
  cells: GbSheetCell[];
  totalCollect: number | null;
  totalFinal: number | null;
  total: number | null;
}

export interface GbSheetExam {
  id: string; title: string; purpose: ExamLink['purpose']; retakeOf: string | null; status: ExamStatus; createdAt: string;
}

export interface GbSheet {
  classroom: {
    id: string; name: string; subjectId: string; gradeId: string; academicYear: number; term: number; studentCount: number;
    status: 'open' | 'closed'; settings: Required<GbSettings>;
  };
  seatCount: number;
  /** เรียงตามแผนการสอน · ปลายภาคท้ายสุด */
  columns: GbSheetColumn[];
  rows: GbSheetRow[];
  totals: { collectMax: number | null; finalMax: number | null; max: number | null; unsetColumns: number };
  /** ตัวชี้วัดที่มีคะแนนจากการสอบแต่ห้องยังไม่มีช่อง */
  unplannedIndicators: string[];
  /** ทุกชุดของห้อง (ทุกประเภท) เรียงตามวันที่สร้าง */
  exams: GbSheetExam[];
  /** คะแนนจริงรายชุด (ใช้แสดงรายละเอียดรายคน/เลือกครั้งสอบซ่อม) */
  attempts: GbAttempt[];
  retakeChoices: GbRetakeChoice[];
}
