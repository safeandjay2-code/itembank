import type { FigureSpec } from '../modules/bank/figure/spec';
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
