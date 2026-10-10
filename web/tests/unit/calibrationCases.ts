// ข้อมูลทดสอบวงจรปรับความยาก (เฟส 7)
//   KNOWN: กรณีขอบที่รู้คำตอบล่วงหน้า (คิดมือจากเส้นแบ่ง ง่าย > 0.80 · ปานกลาง 0.50–0.80 · ยาก 0.25–0.50 · ท้าทาย < 0.25, กันชน 0.05)
//   simulations(): จำลองการสอบหลายรอบต่อข้อ (นักเรียนห้องละ 18–36 คน, บางรอบเป็นชั้นอื่น, บางข้อขึ้นเวอร์ชันใหม่)
//     ใช้ทั้งทดสอบหน่วยและสร้าง fixture ให้ฐานข้อมูลจำลองซ้ำทีละรอบ (tests/db/test_phase7.sql)
import levelsJson from '../../../data/levels.json';
import type { DifficultyLevel } from '../../src/core/types';
import { makeRng } from '../../src/modules/assembly/rng';
import {
  applyCalibration, DEFAULT_CALIBRATION, type CalibItemState, type CalibrationConfig, type Decision, type QualityFlag, type StatRound,
} from '../../src/modules/calibration/calibrate';

export const LEVELS: DifficultyLevel[] = levelsJson.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));
export const EASY = 1, MEDIUM = 2, HARD = 3, CHALLENGE = 4;

export interface KnownCase {
  name: string;
  cfg?: Partial<CalibrationConfig>;
  current: number;
  n: number;
  nc: number;
  /** ค่า r เฉลี่ยของรอบที่มี r (ตัวเลข 3 ตำแหน่ง) และ n ของรอบเหล่านั้น */
  r?: number;
  nR?: number;
  expect: Decision;
}

const stay = (flag: QualityFlag | null = null): Decision => ({ target: null, direction: null, flag });
const to = (target: number, direction: 'easier' | 'harder', flag: QualityFlag | null = null): Decision => ({ target, direction, flag });

export const KNOWN: KnownCase[] = [
  // ---- n ยังไม่ถึงเกณฑ์ ----
  { name: 'ง่าย p 0.20 แต่ n 49 → ยังไม่ย้าย', current: EASY, n: 49, nc: 10, expect: stay() },
  { name: 'ง่าย p 0.20 n 50 → ย้ายไปท้าทาย (ข้ามระดับได้)', current: EASY, n: 50, nc: 10, expect: to(CHALLENGE, 'harder') },
  // ---- ช่วงกันชนรอบเส้น 0.80 ----
  { name: 'ง่าย p 0.76 → อยู่ในกันชน ไม่ย้าย', current: EASY, n: 50, nc: 38, expect: stay() },
  { name: 'ง่าย p 0.75 พอดี → ยังไม่ย้าย (ต้องต่ำกว่า 0.75)', current: EASY, n: 100, nc: 75, expect: stay() },
  { name: 'ง่าย p 0.74 → ลงปานกลาง', current: EASY, n: 50, nc: 37, expect: to(MEDIUM, 'harder') },
  { name: 'ปานกลาง p 0.85 พอดี → ยังไม่ขึ้น', current: MEDIUM, n: 100, nc: 85, expect: stay() },
  { name: 'ปานกลาง p 0.86 → ขึ้นง่าย', current: MEDIUM, n: 50, nc: 43, expect: to(EASY, 'easier') },
  { name: 'ปานกลาง p 0.82 → อยู่ในกันชน', current: MEDIUM, n: 50, nc: 41, expect: stay() },
  // ---- เส้น 0.50 ----
  { name: 'ปานกลาง p 0.45 พอดี → ไม่ย้าย', current: MEDIUM, n: 100, nc: 45, expect: stay() },
  { name: 'ปานกลาง p 0.44 → ลงยาก', current: MEDIUM, n: 50, nc: 22, expect: to(HARD, 'harder') },
  { name: 'ยาก p 0.55 พอดี → ไม่ย้าย', current: HARD, n: 100, nc: 55, expect: stay() },
  { name: 'ยาก p 0.56 → ขึ้นปานกลาง', current: HARD, n: 50, nc: 28, expect: to(MEDIUM, 'easier') },
  // ---- เส้น 0.25 ----
  { name: 'ยาก p 0.20 พอดี → ไม่ย้าย', current: HARD, n: 100, nc: 20, expect: stay() },
  { name: 'ยาก p 0.19 → ลงท้าทาย', current: HARD, n: 100, nc: 19, expect: to(CHALLENGE, 'harder') },
  { name: 'ท้าทาย p 0.30 พอดี → ไม่ย้าย', current: CHALLENGE, n: 100, nc: 30, expect: stay() },
  { name: 'ท้าทาย p 0.31 → ขึ้นยาก', current: CHALLENGE, n: 100, nc: 31, expect: to(HARD, 'easier') },
  // ---- ระดับปลายสุด ----
  { name: 'ท้าทาย p 0 → อยู่ระดับยากสุดแล้ว', current: CHALLENGE, n: 60, nc: 0, expect: stay() },
  { name: 'ง่าย p 1.00 → อยู่ระดับง่ายสุดแล้ว', current: EASY, n: 60, nc: 60, expect: stay() },
  // ---- ปลายทางเมื่อ p อยู่บนเส้นพอดี (ง่าย > 0.80 · ยาก ≤ 0.50 · ท้าทาย ≤ 0.25) ----
  { name: 'ปานกลาง p 0.25 พอดี → ท้าทาย (0.25 ไม่ถึง "ยาก")', current: MEDIUM, n: 100, nc: 25, expect: to(CHALLENGE, 'harder') },
  { name: 'ท้าทาย p 0.80 พอดี → ปานกลาง (0.80 ยังไม่ "ง่าย")', current: CHALLENGE, n: 100, nc: 80, expect: to(MEDIUM, 'easier') },
  { name: 'ท้าทาย p 0.90 → ง่าย', current: CHALLENGE, n: 50, nc: 45, expect: to(EASY, 'easier') },
  // ---- ค่า r ----
  { name: 'r −0.10 n 50 → ต้องแก้ด่วน', current: MEDIUM, n: 50, nc: 30, r: -0.1, nR: 50, expect: stay('negative_r') },
  { name: 'r −0.50 แต่ n ของ r 49 → ยังไม่ตัดสิน', current: MEDIUM, n: 80, nc: 48, r: -0.5, nR: 49, expect: stay() },
  { name: 'r 0.199 → ต้องแก้ (ยังสุ่มได้)', current: MEDIUM, n: 50, nc: 30, r: 0.199, nR: 50, expect: stay('low_r') },
  { name: 'r 0.20 พอดี → ไม่ติดป้าย', current: MEDIUM, n: 50, nc: 30, r: 0.2, nR: 50, expect: stay() },
  { name: 'r 0 พอดี → ต้องแก้ (ไม่ติดลบ)', current: MEDIUM, n: 50, nc: 30, r: 0, nR: 50, expect: stay('low_r') },
  { name: 'ย้ายระดับ + r ติดลบพร้อมกัน', current: EASY, n: 60, nc: 30, r: -0.05, nR: 60, expect: to(HARD, 'harder', 'negative_r') },
  // ---- เปลี่ยนเกณฑ์ในตั้งค่า ----
  { name: 'กันชน 0: ง่าย p 0.79 → ปานกลาง', cfg: { buffer: 0 }, current: EASY, n: 100, nc: 79, expect: to(MEDIUM, 'harder') },
  { name: 'กันชน 0: ง่าย p 0.80 พอดี → ไม่ย้าย', cfg: { buffer: 0 }, current: EASY, n: 100, nc: 80, expect: stay() },
  { name: 'กันชน 0.10: ปานกลาง p 0.89 → ไม่ย้าย', cfg: { buffer: 0.1 }, current: MEDIUM, n: 100, nc: 89, expect: stay() },
  { name: 'เกณฑ์ n 30: ยาก p 0.60 n 30 → ปานกลาง', cfg: { minNToMove: 30 }, current: HARD, n: 30, nc: 18, expect: to(MEDIUM, 'easier') },
  { name: 'เกณฑ์ r 0.30 / n 20: r 0.25 → ต้องแก้', cfg: { rFlagBelow: 0.3, rMinN: 20 }, current: HARD, n: 20, nc: 8, r: 0.25, nR: 20, expect: stay('low_r') },
];

export const cfgOf = (c?: Partial<CalibrationConfig>): CalibrationConfig => ({ ...DEFAULT_CALIBRATION, ...c });
/** r เฉลี่ย 3 ตำแหน่ง × n → r_sum_milli */
export const rSumMilli = (r: number | undefined, nR: number | undefined) => (r === undefined || !nR ? 0 : Math.round(r * 1000) * nR);

// ---------- การจำลองสอบหลายรอบ ----------

export interface SimRound extends StatRound {
  /** ขึ้นเวอร์ชันใหม่ก่อนรอบนี้ (ครูแก้เนื้อหาสำคัญ) */
  bumpVersion?: boolean;
}
export interface SimStep { difficulty: number; flag: QualityFlag | null; status: string; moved: boolean }
export interface Simulation {
  name: string;
  itemId: string;
  gradeId: string;
  cfg: CalibrationConfig;
  start: number;
  rounds: SimRound[];
  /** สถานะของข้อหลังแต่ละรอบ (คำนวณด้วย applyCalibration) */
  steps: SimStep[];
}

const GRADES = ['P4', 'P5', 'P6'];
export const simItemId = (k: number) => `00000000-0000-4000-c700-${String(k).padStart(12, '0')}`;

interface SimSpec { seed: number; truth: number[]; rTrue: number; otherGradeRate?: number; bumpAt?: number; cfg?: Partial<CalibrationConfig>; start?: number; rounds?: number }

/** truth = ค่า p จริงของเด็ก (เปลี่ยนได้ระหว่างทาง เช่น หลังแก้ข้อ) */
export const SIM_SPECS: SimSpec[] = [
  { seed: 11, truth: [0.9], rTrue: 0.45 },                       // ข้อง่ายจริง วางไว้ปานกลาง → ควรขึ้นง่าย
  { seed: 12, truth: [0.35], rTrue: 0.4, start: EASY },          // ครูคาดว่าง่าย แต่จริงยาก
  { seed: 13, truth: [0.12], rTrue: 0.3, start: MEDIUM },        // ท้าทายจริง
  { seed: 14, truth: [0.78], rTrue: 0.35, start: EASY },         // อยู่ใกล้เส้น 0.80 (กันชนต้องกันไม่ให้แกว่ง)
  { seed: 15, truth: [0.52], rTrue: 0.3, start: MEDIUM },        // ใกล้เส้น 0.50
  { seed: 16, truth: [0.6], rTrue: -0.2, start: MEDIUM },        // r ติดลบ → หยุดสุ่ม
  { seed: 17, truth: [0.6], rTrue: 0.1, start: MEDIUM },         // r ต่ำ → ต้องแก้แต่ยังสุ่ม
  { seed: 18, truth: [0.9], rTrue: 0.5, otherGradeRate: 0.5, start: HARD },   // ครึ่งหนึ่งเป็นชั้นอื่น (ไม่นับ)
  { seed: 19, truth: [0.3, 0.85], rTrue: 0.1, bumpAt: 5, start: MEDIUM },     // ขึ้นเวอร์ชันใหม่ → สถิติเริ่มใหม่ ป้ายหาย
  { seed: 20, truth: [0.22], rTrue: 0.25, start: HARD, cfg: { buffer: 0 } },  // ไม่มีกันชน (ตั้งค่า)
  { seed: 21, truth: [0.95], rTrue: 0.15, start: CHALLENGE, rounds: 12 },
  { seed: 22, truth: [0.5], rTrue: 0.22, start: HARD, rounds: 14 },
];

function binomial(n: number, p: number, rng: () => number) { let k = 0; for (let i = 0; i < n; i++) if (rng() < p) k++; return k; }

export function simulation(spec: SimSpec, k: number): Simulation {
  const rng = makeRng(spec.seed);
  const gradeId = GRADES[k % 3];
  const cfg = cfgOf(spec.cfg);
  const start = spec.start ?? MEDIUM;
  const total = spec.rounds ?? 10;
  const rounds: SimRound[] = [];
  const steps: SimStep[] = [];
  let state: CalibItemState = { currentDifficulty: start, status: 'active', qualityFlag: null, currentVersion: 1, gradeId };
  const all: StatRound[] = [];
  for (let i = 0; i < total; i++) {
    if (state.status === 'needs_fix') break; // ข้อที่หยุดสุ่มไม่ถูกใช้สอบอีก
    const bump = spec.bumpAt === i;
    if (bump) {
      state = { ...state, currentVersion: state.currentVersion + 1, qualityFlag: null };
    }
    const truth = spec.truth[Math.min(spec.truth.length - 1, spec.bumpAt !== undefined && i >= spec.bumpAt ? 1 : 0)];
    const n = 18 + Math.floor(rng() * 19);
    const other = rng() < (spec.otherGradeRate ?? 0.1);
    const g = other ? GRADES[(k + 1 + Math.floor(rng() * 2)) % 3] : gradeId;
    const nc = binomial(n, other ? Math.min(1, truth + 0.15) : truth, rng);
    const r = Math.round(Math.max(-1, Math.min(1, spec.rTrue + (rng() - 0.5) * 0.3)) * 1000) / 1000;
    const round: SimRound = { version: state.currentVersion, gradeId: g, n, nCorrect: nc, r, ...(bump ? { bumpVersion: true } : {}) };
    rounds.push(round);
    all.push(round);
    const res = applyCalibration(LEVELS, cfg, state, all);
    if (res) state = res.state;
    steps.push({ difficulty: state.currentDifficulty, flag: state.qualityFlag, status: state.status, moved: !!res?.moved });
  }
  return { name: `จำลอง seed ${spec.seed}`, itemId: simItemId(k + 1), gradeId, cfg, start, rounds, steps };
}

export const simulations = () => SIM_SPECS.map((s, k) => simulation(s, k));
