// วิเคราะห์ผลสอบ (SPEC §9) — ฟังก์ชันล้วน ไม่แตะฐานข้อมูล ใช้ทั้งหน้ารายงาน ไฟล์ Excel และโหมดสาธิต
// ฐานข้อมูลคำนวณสถิติรายข้อซ้ำเองตอนปิดชุด (migration 0009 analysis_item_stats) ด้วยกฎเดียวกัน
// และมีชุดทดสอบเทียบผลสองฝั่งด้วยข้อมูลชุดเดียวกัน (tests/db/fixtures/phase6_analysis.json)
//
// นิยาม
//   * นับเฉพาะเลขที่ที่ตรวจแล้ว (n) — เลขที่ที่ยังไม่ตรวจไม่ถูกนับเป็น 0
//   * คำตอบของนักเรียนถูกแปลงกลับเป็น "ตัวเลือกต้นฉบับ" ของข้อ (ไม่ขึ้นกับการสลับของชุด) จึงรวมสถิติข้ามชุด/ข้ามรอบได้
//   * p = ตอบถูก ÷ n
//   * r = เทคนิค 27%: เรียงนักเรียนตามคะแนนรวม (มาก→น้อย, คะแนนเท่ากันเรียงเลขที่น้อย→มาก)
//         กลุ่มสูง = g คนแรก กลุ่มต่ำ = g คนสุดท้าย, g = ปัด(0.27 × n) · r = (ถูกในกลุ่มสูง − ถูกในกลุ่มต่ำ) ÷ g
//         คำนวณเมื่อ n ≥ analysis.r_min_n เท่านั้น
//   * ผ่านตัวชี้วัด = ตอบถูก ≥ report.indicator_pass_ratio × จำนวนข้อของตัวชี้วัดนั้น
import type { DifficultyLevel, ExamDetail, ScanAnswer, ScanResponse, Settings } from '../../core/types';

export interface AnalysisConfig {
  /** สัดส่วนข้อที่ต้องตอบถูกจึงผ่านตัวชี้วัด */
  passRatio: number;
  /** สัดส่วนกลุ่มสูง/ต่ำ (0.27) */
  groupRatio: number;
  /** n ขั้นต่ำที่จะคำนวณ r */
  rMinN: number;
  /** r ต่ำกว่านี้ = ควรปรับปรุง */
  rFlagBelow: number;
  /** ตัวลวงที่มีคนเลือก ≥ สัดส่วนนี้ (หรือมากกว่าคำตอบถูก) = เด็กหลงมาก */
  strongDistractor: number;
  /** ตัวลวงที่มีคนเลือกน้อยกว่าสัดส่วนนี้ (เมื่อ n ≥ rMinN) = แทบไม่มีใครเลือก */
  deadDistractor: number;
}

export const DEFAULT_ANALYSIS: AnalysisConfig = {
  passRatio: 0.5, groupRatio: 0.27, rMinN: 6, rFlagBelow: 0.2, strongDistractor: 0.25, deadDistractor: 0.05,
};

export function analysisConfigFromSettings(s: Settings): AnalysisConfig {
  const num = (k: string, d: number) => (typeof s[k] === 'number' ? (s[k] as number) : d);
  return {
    passRatio: num('report.indicator_pass_ratio', DEFAULT_ANALYSIS.passRatio),
    groupRatio: num('analysis.group_ratio', DEFAULT_ANALYSIS.groupRatio),
    rMinN: num('analysis.r_min_n', DEFAULT_ANALYSIS.rMinN),
    rFlagBelow: num('calibration.r_flag_below', DEFAULT_ANALYSIS.rFlagBelow),
    strongDistractor: num('report.strong_distractor_ratio', DEFAULT_ANALYSIS.strongDistractor),
    deadDistractor: num('report.dead_distractor_ratio', DEFAULT_ANALYSIS.deadDistractor),
  };
}

/** คำตอบในรูปตัวเลือกต้นฉบับ: 1–4 | 'blank' | 'multi' */
export type OrigAnswer = 1 | 2 | 3 | 4 | 'blank' | 'multi';
export type OptionKey = '1' | '2' | '3' | '4' | 'blank' | 'multi';
export const OPTION_KEYS: OptionKey[] = ['1', '2', '3', '4', 'blank', 'multi'];
export type OptionCounts = Record<OptionKey, number>;

export interface DistractorInfo {
  /** ตัวเลือกต้นฉบับ 1–4 */
  option: number;
  count: number;
  ratio: number;
  /** ความเข้าใจผิดที่ตัวลวงนี้สะท้อน (จากคลัง) */
  rationale: string | null;
  /** เด็กหลงมาก */
  strong: boolean;
  /** แทบไม่มีใครเลือก (ตัวลวงไม่ทำงาน) */
  dead: boolean;
  /** กลุ่มสูงเลือกมากกว่ากลุ่มต่ำ (ตัวลวงดึงเด็กเก่ง — ควรตรวจโจทย์) */
  attractsUpper: boolean;
}

export interface ItemStat {
  itemId: string;
  itemCode: string;
  basePosition: number;
  indicatorId: string;
  difficulty: number;
  version: number;
  /** เฉลย (ตัวเลือกต้นฉบับ) */
  answer: number;
  n: number;
  nCorrect: number;
  p: number | null;
  r: number | null;
  groupSize: number;
  upperCorrect: number;
  lowerCorrect: number;
  counts: OptionCounts;
  distractors: DistractorInfo[];
  /** ตำแหน่งของข้อนี้ในแต่ละชุด */
  positions: Record<number, number>;
}

export interface StudentIndicator { correct: number; total: number; pass: boolean }

export interface StudentRow {
  seatNo: number;
  setNo: number;
  score: number;
  percent: number;
  /** ตามลำดับ indicators ของรายงาน */
  indicators: StudentIndicator[];
  passedIndicators: number;
  /** คำตอบ (ตัวเลือกต้นฉบับ) เรียงตามลำดับมาตรฐานของข้อ */
  answers: OrigAnswer[];
  correct: boolean[];
  /** remark ที่ครูยังไม่ยืนยัน */
  unresolved: number;
}

export interface IndicatorStat {
  indicatorId: string;
  itemCount: number;
  /** สัดส่วนตอบถูกเฉลี่ยของห้อง */
  meanRatio: number | null;
  passCount: number;
  passRate: number | null;
  /** ตัวชี้วัดที่อ่อน: ผ่านไม่ถึงครึ่งห้อง */
  weak: boolean;
}

export interface ClassSummary {
  studentCount: number;
  n: number;
  missingSeats: number[];
  itemCount: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  meanPercent: number | null;
  /** ร้อยละ 0–9, 10–19, …, 90–100 */
  histogram: number[];
  unresolvedSeats: number[];
}

export interface Analysis {
  config: AnalysisConfig;
  summary: ClassSummary;
  items: ItemStat[];
  indicators: IndicatorStat[];
  students: StudentRow[];
}

const round = (num: number, den: number, places = 3) => {
  const f = 10 ** places;
  return Math.round((f * num) / den) / f;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

/** ขนาดกลุ่มสูง/ต่ำ */
export function groupSize(n: number, ratio: number): number {
  return Math.max(1, Math.round(Math.round(n * ratio * 1e6) / 1e6));
}

/** แปลงคำตอบที่ตำแหน่งในชุด → ตัวเลือกต้นฉบับ */
export function toOriginal(a: ScanAnswer, optionOrder: number[]): OrigAnswer {
  if (a === null) return 'blank';
  if (a === 'multi') return 'multi';
  return optionOrder[a - 1] as 1 | 2 | 3 | 4;
}

/** ลำดับนักเรียนสำหรับแบ่งกลุ่ม: คะแนนมาก→น้อย, เท่ากันเลขที่น้อยก่อน */
export function rankStudents<T extends { seatNo: number; score: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => b.score - a.score || a.seatNo - b.seatNo);
}

export function analyze(exam: ExamDetail, responses: ScanResponse[], cfg: AnalysisConfig = DEFAULT_ANALYSIS): Analysis {
  const items = exam.items.slice().sort((a, b) => a.basePosition - b.basePosition);
  const idx = new Map(items.map((it, k) => [it.itemId, k]));
  const setMap = new Map(exam.sets.map((s) => [s.setNo, s.entries]));

  const indicatorIds: string[] = [];
  for (const it of items) if (!indicatorIds.includes(it.indicatorId)) indicatorIds.push(it.indicatorId);
  const itemsOfInd = indicatorIds.map((id) => items.map((it, k) => (it.indicatorId === id ? k : -1)).filter((k) => k >= 0));

  // ---------- รายเลขที่ ----------
  const students: StudentRow[] = responses.slice().sort((a, b) => a.seatNo - b.seatNo).map((r) => {
    const entries = setMap.get(r.setNo) ?? [];
    const answers: OrigAnswer[] = items.map(() => 'blank');
    for (const e of entries) {
      const k = idx.get(e.itemId);
      if (k !== undefined) answers[k] = toOriginal(r.answers[e.position - 1] ?? null, e.optionOrder);
    }
    const correct = items.map((it, k) => answers[k] === it.answer);
    const score = correct.filter(Boolean).length;
    const inds = itemsOfInd.map((ks) => {
      const c = ks.filter((k) => correct[k]).length;
      return { correct: c, total: ks.length, pass: c >= cfg.passRatio * ks.length - 1e-9 };
    });
    return {
      seatNo: r.seatNo, setNo: r.setNo, score, percent: round(100 * score, items.length || 1, 2), indicators: inds,
      passedIndicators: inds.filter((x) => x.pass).length, answers, correct,
      unresolved: r.flags.filter((f) => !f.resolved).length,
    };
  });
  const n = students.length;

  // ---------- รายข้อ ----------
  const ranked = rankStudents(students);
  const g = groupSize(n, cfg.groupRatio);
  const withR = n >= cfg.rMinN && n >= 2;
  const upper = withR ? ranked.slice(0, g) : [];
  const lower = withR ? ranked.slice(n - g) : [];
  const itemStats: ItemStat[] = items.map((it, k) => {
    const counts: OptionCounts = { 1: 0, 2: 0, 3: 0, 4: 0, blank: 0, multi: 0 } as OptionCounts;
    for (const s of students) counts[String(s.answers[k]) as OptionKey] += 1;
    const nCorrect = counts[String(it.answer) as OptionKey];
    const upperCorrect = upper.filter((s) => s.correct[k]).length;
    const lowerCorrect = lower.filter((s) => s.correct[k]).length;
    const rationale = it.content?.distractor_rationale ?? [];
    const distractors: DistractorInfo[] = [1, 2, 3, 4].filter((o) => o !== it.answer).map((o) => {
      const count = counts[String(o) as OptionKey];
      const up = upper.filter((s) => s.answers[k] === o).length, lo = lower.filter((s) => s.answers[k] === o).length;
      return {
        option: o, count, ratio: n ? round(count, n) : 0, rationale: rationale[o - 1] ?? null,
        strong: n > 0 && count > 0 && (count >= cfg.strongDistractor * n - 1e-9 || count > nCorrect),
        dead: n >= cfg.rMinN && count < cfg.deadDistractor * n - 1e-9,
        attractsUpper: withR && up > lo,
      };
    });
    const positions: Record<number, number> = {};
    for (const s of exam.sets) {
      const e = s.entries.find((x) => x.itemId === it.itemId);
      if (e) positions[s.setNo] = e.position;
    }
    return {
      itemId: it.itemId, itemCode: it.itemCode, basePosition: it.basePosition, indicatorId: it.indicatorId, difficulty: it.difficulty,
      version: it.version, answer: it.answer, n, nCorrect, p: n ? round(nCorrect, n) : null,
      r: withR ? round(upperCorrect - lowerCorrect, g) : null, groupSize: withR ? g : 0, upperCorrect, lowerCorrect,
      counts, distractors, positions,
    };
  });

  // ---------- รายตัวชี้วัด ----------
  const indicators: IndicatorStat[] = indicatorIds.map((id, j) => {
    const ks = itemsOfInd[j];
    const passCount = students.filter((s) => s.indicators[j].pass).length;
    const totalCorrect = students.reduce((a, s) => a + s.indicators[j].correct, 0);
    const passRate = n ? round(passCount, n) : null;
    return {
      indicatorId: id, itemCount: ks.length, meanRatio: n ? round(totalCorrect, n * ks.length) : null,
      passCount, passRate, weak: passRate !== null && passRate < 0.5,
    };
  });

  // ---------- ภาพรวมห้อง ----------
  const scores = students.map((s) => s.score).sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : null;
  const sd = n >= 2 ? Math.sqrt(scores.reduce((a, x) => a + (x - mean!) ** 2, 0) / (n - 1)) : n === 1 ? 0 : null;
  const median = n ? (n % 2 ? scores[(n - 1) / 2] : (scores[n / 2 - 1] + scores[n / 2]) / 2) : null;
  const histogram = Array.from({ length: 10 }, () => 0);
  for (const s of students) histogram[Math.min(9, Math.floor(s.percent / 10))] += 1;
  const scanned = new Set(students.map((s) => s.seatNo));
  const summary: ClassSummary = {
    studentCount: exam.studentCount, n, itemCount: items.length,
    missingSeats: exam.seats.map((s) => s.seatNo).filter((s) => !scanned.has(s)),
    mean: n ? round(sum, n, 2) : null, sd: sd === null ? null : round2(sd), median,
    min: n ? scores[0] : null, max: n ? scores[n - 1] : null,
    meanPercent: !n || !items.length ? null : round(100 * sum, n * items.length, 2),
    histogram, unresolvedSeats: students.filter((s) => s.unresolved > 0).map((s) => s.seatNo),
  };

  return { config: cfg, summary, items: itemStats, indicators, students };
}

// ---------- คำอธิบายค่า ----------

/** ระดับความยากตามค่า p (ใช้เส้นแบ่งจากตาราง difficulty_levels) */
export function difficultyOfP(p: number | null, levels: DifficultyLevel[]): DifficultyLevel | null {
  if (p === null) return null;
  const sorted = levels.slice().sort((a, b) => b.pLower - a.pLower);
  return sorted.find((d) => p >= d.pLower) ?? sorted[sorted.length - 1] ?? null;
}

/** คำอธิบายค่า r (เกณฑ์ของ Ebel — เส้น "ควรปรับปรุง" มาจากตั้งค่า calibration.r_flag_below) */
export function rLabel(r: number | null, cfg: AnalysisConfig = DEFAULT_ANALYSIS): { text: string; level: 'good' | 'ok' | 'weak' | 'bad' | 'none' } {
  if (r === null) return { text: 'n น้อยเกินไป', level: 'none' };
  if (r < 0) return { text: 'ติดลบ — ต้องแก้ด่วน', level: 'bad' };
  if (r < cfg.rFlagBelow) return { text: 'ควรปรับปรุง', level: 'weak' };
  if (r < 0.3) return { text: 'พอใช้', level: 'ok' };
  if (r < 0.4) return { text: 'ดี', level: 'good' };
  return { text: 'ดีมาก', level: 'good' };
}

export function optionLabel(k: OptionKey | OrigAnswer): string {
  const s = String(k);
  if (s === 'blank') return 'ไม่ฝน';
  if (s === 'multi') return 'ฝนหลายช่อง';
  return `${s})`;
}
