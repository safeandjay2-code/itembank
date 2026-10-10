// วงจรปรับความยาก (SPEC §11) — ฟังก์ชันล้วน ไม่แตะฐานข้อมูล
// ฐานข้อมูลตัดสินซ้ำเองด้วยกฎเดียวกัน (migration 0010 calib_decide) และมีชุดทดสอบเทียบผลสองฝั่ง
// ด้วยข้อมูลชุดเดียวกัน (tests/db/fixtures/phase7_calibration.json) — ใช้ในโหมดสาธิตและหน้าเว็บ
//
// กฎ
//   * สถิติ = เวอร์ชันปัจจุบันของข้อ เฉพาะรอบของชั้นเดียวกับตัวชี้วัด (calibration.same_grade_only)
//   * ย้ายระดับเมื่อ n ≥ calibration.min_n_to_move และ p หลุดช่วงของระดับปัจจุบันเกินช่วงกันชน
//       ลง (ยากขึ้น) เมื่อ p < เส้นล่าง − กันชน · ขึ้น (ง่ายขึ้น) เมื่อ p > เส้นบน + กันชน
//       ไปอยู่ระดับที่ p ตกอยู่: ระดับแรก (เรียงเส้นล่างมาก→น้อย) ที่ p > เส้นล่าง (ไม่มี = ระดับยากสุด)
//   * r (เมื่อ n ของรอบที่มี r ≥ calibration.r_min_n): r < 0 → 'negative_r' (ต้องแก้ด่วน หยุดสุ่มเข้าชุด)
//       r < calibration.r_flag_below → 'low_r' (ต้องแก้ แต่ยังสุ่มเข้าชุดได้)
//   * เทียบด้วยจำนวนเต็มสเกล 1e6 ทั้งหมด เพื่อให้ผลตรงกับฐานข้อมูลทุกกรณีขอบ (เช่น p = 0.75 พอดี)
import type { DifficultyLevel, Settings } from '../../core/types';

export type QualityFlag = 'low_r' | 'negative_r';
export type MoveDirection = 'easier' | 'harder';

export const FLAG_TH: Record<QualityFlag, string> = { low_r: 'ต้องแก้ (r ต่ำ)', negative_r: 'ต้องแก้ด่วน (r ติดลบ)' };
export const DIRECTION_TH: Record<MoveDirection, string> = { easier: 'ง่ายขึ้น', harder: 'ยากขึ้น' };

export interface CalibrationConfig {
  minNToMove: number;
  buffer: number;
  rMinN: number;
  rFlagBelow: number;
  sameGradeOnly: boolean;
  /** เป้าจำนวนข้อต่อช่อง (ตัวชี้วัด × ระดับ) */
  target: number;
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  minNToMove: 50, buffer: 0.05, rMinN: 50, rFlagBelow: 0.2, sameGradeOnly: true, target: 20,
};

export function calibrationConfigFromSettings(s: Settings): CalibrationConfig {
  const num = (k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : d);
  return {
    minNToMove: num('calibration.min_n_to_move', DEFAULT_CALIBRATION.minNToMove),
    buffer: num('calibration.buffer', DEFAULT_CALIBRATION.buffer),
    rMinN: num('calibration.r_min_n', DEFAULT_CALIBRATION.rMinN),
    rFlagBelow: num('calibration.r_flag_below', DEFAULT_CALIBRATION.rFlagBelow),
    sameGradeOnly: typeof s['calibration.same_grade_only'] === 'boolean' ? (s['calibration.same_grade_only'] as boolean) : DEFAULT_CALIBRATION.sameGradeOnly,
    target: num('bank.items_per_level_target', DEFAULT_CALIBRATION.target),
  };
}

/** สถิติ 1 รอบสอบของข้อ (ค่ารวม ไม่มีข้อมูลนักเรียน) */
export interface StatRound { version: number; gradeId: string | null; n: number; nCorrect: number; r: number | null }

/** สถิติที่ใช้ตัดสิน — rSumMilli = Σ ปัด(r × 1000) × n ของรอบที่มี r */
export interface CalibStats { n: number; nCorrect: number; nR: number; rSumMilli: number; p: number | null; r: number | null; rounds: number }

/** ปัดแบบ PostgreSQL round(numeric): .5 ปัดออกจากศูนย์ */
export function roundHalfAway(x: number): number {
  const y = Math.round(Math.abs(x) * 1e9) / 1e9; // ตัดเศษทศนิยมลอยตัว เช่น 0.75 − 0.000000000001
  return Math.sign(x) * Math.round(y);
}

const micro = (x: number) => roundHalfAway(x * 1e6);

export function calibStats(rounds: StatRound[], version: number, gradeId: string, cfg: CalibrationConfig): CalibStats {
  const use = rounds.filter((s) => s.version === version && (!cfg.sameGradeOnly || s.gradeId === gradeId));
  let n = 0, nc = 0, nR = 0, rSum = 0;
  for (const s of use) {
    n += s.n; nc += s.nCorrect;
    if (s.r !== null && s.r !== undefined) { nR += s.n; rSum += roundHalfAway(s.r * 1000) * s.n; }
  }
  return {
    n, nCorrect: nc, nR, rSumMilli: rSum,
    p: n > 0 ? roundHalfAway((nc / n) * 1e4) / 1e4 : null,
    r: nR > 0 ? roundHalfAway((rSum / 1000 / nR) * 1e4) / 1e4 : null,
    rounds: use.length,
  };
}

export interface Decision { target: number | null; direction: MoveDirection | null; flag: QualityFlag | null }

/** ระดับที่ค่า p (= nc/n) ตกอยู่ */
export function levelForP(levels: DifficultyLevel[], n: number, nc: number): number {
  const byLower = [...levels].sort((a, b) => b.pLower - a.pLower || a.id - b.id);
  const hit = byLower.find((d) => nc * 1e6 > micro(d.pLower) * n);
  return (hit ?? [...levels].sort((a, b) => a.pLower - b.pLower || a.id - b.id)[0]).id;
}

export function decide(levels: DifficultyLevel[], cfg: CalibrationConfig, current: number, st: Pick<CalibStats, 'n' | 'nCorrect' | 'nR' | 'rSumMilli'>): Decision {
  let target: number | null = null;
  let direction: MoveDirection | null = null;
  let flag: QualityFlag | null = null;
  const cur = levels.find((d) => d.id === current);
  const bottom = Math.min(...levels.map((d) => d.pLower));
  const top = Math.max(...levels.map((d) => d.pUpper));
  if (cur && st.n >= Math.max(cfg.minNToMove, 1)) {
    if (cur.pLower > bottom && st.nCorrect * 1e6 < micro(cur.pLower - cfg.buffer) * st.n) direction = 'harder';
    else if (cur.pUpper < top && st.nCorrect * 1e6 > micro(cur.pUpper + cfg.buffer) * st.n) direction = 'easier';
    if (direction) {
      target = levelForP(levels, st.n, st.nCorrect);
      if (target === current) { target = null; direction = null; }
    }
  }
  if (st.nR >= Math.max(cfg.rMinN, 1)) {
    if (st.rSumMilli < 0) flag = 'negative_r';
    else if (st.rSumMilli * 1000 < micro(cfg.rFlagBelow) * st.nR) flag = 'low_r';
  }
  return { target, direction, flag };
}

// ---------- ข้อมูลที่หน้าเว็บแสดง ----------

export interface LevelMove {
  itemId: string;
  itemCode: string;
  indicatorId: string;
  version?: number;
  from: number;
  to: number;
  direction: MoveDirection;
  p: number;
  n: number;
  r?: number | null;
  movedAt?: string;
}

export interface FlagChange { itemId: string; itemCode: string; indicatorId?: string; flag: QualityFlag | null; from?: QualityFlag | null; r: number | null; nR?: number }

export interface Shortfall {
  indicatorId: string;
  indicatorCode: string;
  gradeId: string;
  difficultyId: number;
  ready: number;
  target: number;
  draft?: number;
  needsFix?: number;
  /** ข้อที่ย้ายออกจากช่องนี้ในช่วงล่าสุด */
  movedOut?: number;
}

/** ผลการปรับ 1 ครั้ง (calibration_runs.summary) */
export interface CalibrationRun {
  runId: number;
  source: 'exam' | 'manual';
  examId: string | null;
  itemsChecked: number;
  moved: LevelMove[];
  flagged: FlagChange[];
  unflagged: FlagChange[];
  /** จำนวนข้อที่หยุดสุ่มเข้าชุดเพราะ r ติดลบ */
  stopped: number;
  /** ช่องที่ต่ำกว่าเป้าเพราะมีข้อย้ายออกในรอบนี้ */
  shortfalls: Shortfall[];
}

export interface RunSummaryRow { id: number; source: 'exam' | 'manual'; examId: string | null; ranAt: string; itemsChecked: number; moved: number; flagged: number; unflagged: number; shortfalls: number }

export interface BankHealth {
  generatedAt: string;
  settings: { target: number; minNToMove: number; buffer: number; rFlagBelow: number; rMinN: number; sameGradeOnly: boolean; recentDays: number };
  statusCounts: Record<string, number>;
  sampleCount: number;
  nBuckets: { none: number; collecting: number; calibrated: number };
  coverage: { cells: number; full: number; empty: number; readyTotal: number; targetTotal: number };
  shortfalls: Shortfall[];
  flagged: Array<{ itemId: string; itemCode: string; indicatorId: string; indicatorCode: string; gradeId: string; difficulty: number; status: string;
    flag: QualityFlag; flagAt: string | null; r: number | null; nR: number | null; p: number | null; n: number | null }>;
  needsFixCount: number;
  recentMoves: Array<LevelMove & { indicatorCode: string; gradeId: string }>;
  moveTotals: { easier: number; harder: number; allTime: number };
  levelMix: Array<{ difficulty: number; est: number; current: number }>;
  runs: RunSummaryRow[];
}

export interface ItemCalibrationInfo {
  stats: CalibStats & { gradeId: string; version: number };
  decision: Decision;
  rounds: Array<StatRound & { optionCounts: Record<string, number>; recordedAt: string }>;
  moves: Array<{ version: number; from: number; to: number; direction: MoveDirection; p: number; n: number; r: number | null; movedAt: string }>;
}

/** คำอธิบายสั้น ๆ ว่าข้ออยู่ตรงไหนของวงจร (ใช้ในหน้าแก้ไขข้อ) */
export function describeProgress(cfg: CalibrationConfig, st: Pick<CalibStats, 'n' | 'nR'>): string {
  if (st.n === 0) return 'ยังไม่มีสถิติจากการสอบจริง';
  if (st.n < cfg.minNToMove) return `เก็บสถิติแล้ว ${st.n}/${cfg.minNToMove} คน — ครบแล้วระบบจึงพิจารณาย้ายระดับ`;
  return `สถิติครบเกณฑ์ (n = ${st.n}) ระบบปรับระดับอัตโนมัติทุกครั้งที่ปิดชุดข้อสอบ`;
}

// ---------- ปรับ 1 ข้อ (กฎเดียวกับ calib_apply_item ในฐานข้อมูล) ----------

export interface CalibItemState {
  currentDifficulty: number;
  status: string;
  qualityFlag: QualityFlag | null;
  currentVersion: number;
  gradeId: string;
}

export interface ApplyResult {
  state: CalibItemState;
  stats: CalibStats;
  decision: Decision;
  moved: { from: number; to: number; direction: MoveDirection } | null;
  flagChanged: { from: QualityFlag | null; to: QualityFlag | null } | null;
  /** เปลี่ยนเป็น "ต้องแก้" เพราะ r ติดลบ (หยุดสุ่มเข้าชุด) */
  stopped: boolean;
}

/** ข้อที่วงจรปรับความยากพิจารณา (ร่าง/เลิกใช้ไม่ถูกปรับ) */
export const CALIBRATED_STATUSES = ['reviewed', 'active', 'needs_fix'];

export function applyCalibration(levels: DifficultyLevel[], cfg: CalibrationConfig, item: CalibItemState, rounds: StatRound[]): ApplyResult | null {
  if (!CALIBRATED_STATUSES.includes(item.status)) return null;
  const stats = calibStats(rounds, item.currentVersion, item.gradeId, cfg);
  const decision = decide(levels, cfg, item.currentDifficulty, stats);
  const state = { ...item };
  let moved: ApplyResult['moved'] = null;
  let flagChanged: ApplyResult['flagChanged'] = null;
  let stopped = false;
  if (decision.target !== null && decision.direction) {
    moved = { from: item.currentDifficulty, to: decision.target, direction: decision.direction };
    state.currentDifficulty = decision.target;
  }
  if (decision.flag !== item.qualityFlag) {
    flagChanged = { from: item.qualityFlag, to: decision.flag };
    state.qualityFlag = decision.flag;
    if (decision.flag === 'negative_r' && (item.status === 'reviewed' || item.status === 'active')) {
      state.status = 'needs_fix';
      stopped = true;
    }
  }
  return { state, stats, decision, moved, flagChanged, stopped };
}
