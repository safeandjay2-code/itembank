// ข้อมูลจำลองสำหรับทดสอบการวิเคราะห์ (เฟส 6)
//   knownCase(): กรณีที่คำนวณ p, r, ตัวชี้วัด, ค่าเฉลี่ย ฯลฯ ด้วยมือไว้ล่วงหน้า (ดูตารางในไฟล์ analysis.test.ts)
//   randomCase(): ชุดข้อสอบ/คำตอบสุ่ม (นักเรียนเก่ง-อ่อนต่างกัน) ใช้เทียบผลหน้าเว็บกับฐานข้อมูล
import type { ExamDetail, ScanAnswer, ScanResponse } from '../../src/core/types';
import { makeRng } from '../../src/modules/assembly/rng';
import type { OrigAnswer } from '../../src/modules/analysis/analyze';

export const IND_A = 'MATH-2560-P4-01', IND_B = 'MATH-2560-P4-02', IND_C = 'MATH-2560-P4-03';
export const uuid = (prefix: string, k: number) => `00000000-0000-4000-${prefix}-${String(k).padStart(12, '0')}`;

export interface CaseItem { id: string; code: string; indicatorId: string; difficulty: number; answer: number; rationale?: Array<string | null> }
export interface Case {
  name: string;
  examId: string;
  studentCount: number;
  items: CaseItem[];
  /** ต่อชุด: ลำดับข้อ (index ใน items) + ลำดับตัวเลือก */
  sets: Array<Array<{ item: number; optionOrder: number[] }>>;
  /** คำตอบรายเลขที่ในรูปตัวเลือกต้นฉบับ ตามลำดับ items · ไม่มี = ยังไม่ตรวจ */
  answers: Record<number, OrigAnswer[]>;
  /** เลขที่ที่มี remark ยังไม่ยืนยัน */
  unresolved?: number[];
}

export const seatSetOf = (seat: number, sets: number) => ((seat - 1) % sets) + 1;

export function toExam(c: Case): ExamDetail {
  const S = c.sets.length;
  return {
    id: c.examId, title: c.name, gradeId: 'P4', itemCount: c.items.length, setCount: S, studentCount: c.studentCount,
    status: 'open', createdAt: '2026-10-10T00:00:00Z', durationMin: 30, rows: [], build: null, hasResponses: true, templateVersion: 1,
    openedAt: null, expiresAt: null, closedAt: null, closedSummary: null, roundStats: [],
    items: c.items.map((it, k) => ({ itemId: it.id, itemCode: it.code, version: 1, basePosition: k + 1, indicatorId: it.indicatorId,
      difficulty: it.difficulty, isAnchor: false, noShuffle: false, n: 0, answer: it.answer,
      content: { stem: `โจทย์ ${it.code}`, options: ['ก', 'ข', 'ค', 'ง'], figure: null, explanation: '',
        distractor_rationale: it.rationale ?? [null, null, null, null] } })),
    sets: c.sets.map((entries, s) => ({ setNo: s + 1, entries: entries.map((e, p) => ({ position: p + 1, itemId: c.items[e.item].id,
      optionOrder: e.optionOrder, key: e.optionOrder.indexOf(c.items[e.item].answer) + 1 })) })),
    seats: Array.from({ length: c.studentCount }, (_, k) => ({ seatNo: k + 1, setNo: seatSetOf(k + 1, S) })),
  };
}

/** คำตอบต้นฉบับ → คำตอบตามตำแหน่งบนกระดาษของชุด */
export function toSheet(c: Case, seat: number): ScanAnswer[] {
  const setNo = seatSetOf(seat, c.sets.length);
  const orig = c.answers[seat];
  return c.sets[setNo - 1].map((e) => {
    const a = orig[e.item];
    if (a === 'blank') return null;
    if (a === 'multi') return 'multi';
    return (e.optionOrder.indexOf(a) + 1) as 1 | 2 | 3 | 4;
  });
}

export function toResponses(c: Case): ScanResponse[] {
  const exam = toExam(c);
  return Object.keys(c.answers).map(Number).map((seat) => {
    const setNo = seatSetOf(seat, c.sets.length);
    const answers = toSheet(c, seat);
    const keys = exam.sets[setNo - 1].entries.map((e) => e.key);
    return { seatNo: seat, setNo, answers, score: keys.filter((k, i) => answers[i] === k).length,
      flags: (c.unresolved ?? []).includes(seat) ? [{ type: 'ambiguous', positions: [1], resolved: false }] : [],
      source: 'upload', scannedAt: '2026-10-10T00:00:00Z' } as ScanResponse;
  });
}

/**
 * กรณีคำนวณมือ: 5 ข้อ 2 ชุด นักเรียน 12 คน ตรวจแล้ว 10 คน (เลขที่ 11–12 ขาดสอบ)
 *   ข้อ 1–2 = ตัวชี้วัด A · ข้อ 3–5 = ตัวชี้วัด B · เฉลยต้นฉบับ 1,2,3,4,1
 *   ชุด 2 เรียงข้อกลับด้านและหมุนตัวเลือก (ทดสอบการแปลงกลับเป็นตัวเลือกต้นฉบับ)
 */
export function knownCase(): Case {
  const items: CaseItem[] = [
    { id: uuid('b000', 1), code: 'M-800001', indicatorId: IND_A, difficulty: 1, answer: 1 },
    { id: uuid('b000', 2), code: 'M-800002', indicatorId: IND_A, difficulty: 2, answer: 2 },
    { id: uuid('b000', 3), code: 'M-800003', indicatorId: IND_B, difficulty: 2, answer: 3, rationale: ['บวกเศษกับเศษ ส่วนกับส่วน', 'ลืมทด', null, 'อ่านโจทย์ไม่ครบ'] },
    { id: uuid('b000', 4), code: 'M-800004', indicatorId: IND_B, difficulty: 3, answer: 4, rationale: ['สับสนหน่วย', 'คูณแทนหาร', null, null] },
    { id: uuid('b000', 5), code: 'M-800005', indicatorId: IND_B, difficulty: 4, answer: 1 },
  ];
  const id = [1, 2, 3, 4];
  const rot = [2, 3, 4, 1];
  const sets = [
    items.map((_, k) => ({ item: k, optionOrder: id })),
    items.map((_, k) => ({ item: 4 - k, optionOrder: rot })),
  ];
  const b = 'blank' as const, m = 'multi' as const;
  const answers: Record<number, OrigAnswer[]> = {
    1: [1, 2, 3, 4, 2],
    2: [1, 2, 3, 4, 2],
    3: [1, 2, 3, 1, 2],
    4: [1, 2, 4, 2, 2],
    5: [1, 3, 3, b, 2],
    6: [1, 3, 1, m, 2],
    7: [2, 2, 1, 1, 2],
    8: [1, 3, 1, 1, 1],
    9: [2, 3, 2, 1, 1],
    10: [3, 1, 1, 2, 1],
  };
  return { name: 'กรณีคำนวณมือ', examId: uuid('e000', 1), studentCount: 12, items, sets, answers, unresolved: [5] };
}

/** ชุดสุ่ม: นักเรียนมีความสามารถต่างกัน ข้อมีความยากต่างกัน ตัวลวงบางตัวดึงดูดกว่า */
export function randomCase(seed: number, opts: { items: number; sets: number; students: number; scanned: number }): Case {
  const rng = makeRng(seed);
  const inds = [IND_A, IND_B, IND_C];
  const items: CaseItem[] = Array.from({ length: opts.items }, (_, k) => ({
    id: uuid('c' + String(seed).padStart(3, '0'), k + 1), code: `M-7${String(seed).padStart(2, '0')}${String(k + 1).padStart(3, '0')}`,
    indicatorId: inds[Math.min(2, Math.floor((k * 3) / opts.items))], difficulty: 1 + Math.floor(rng() * 4), answer: 1 + Math.floor(rng() * 4),
  }));
  const perm = (n: number) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sets = Array.from({ length: opts.sets }, (_, s) => (s === 0 ? items.map((_, k) => k) : perm(items.length))
    .map((k) => ({ item: k, optionOrder: s === 0 ? [1, 2, 3, 4] : perm(4).map((x) => x + 1) })));
  const diffs = items.map(() => rng() * 2 - 1);
  const lure = items.map(() => 1 + Math.floor(rng() * 4));
  const seats = perm(opts.students).slice(0, opts.scanned).map((x) => x + 1).sort((a, b) => a - b);
  const answers: Record<number, OrigAnswer[]> = {};
  for (const seat of seats) {
    const ability = rng() * 2.4 - 1.2;
    answers[seat] = items.map((it, k) => {
      const u = rng();
      if (u < 0.03) return 'blank';
      if (u < 0.05) return 'multi';
      if (rng() < 1 / (1 + Math.exp(-(ability - diffs[k]) * 2.2))) return it.answer as 1 | 2 | 3 | 4;
      if (rng() < 0.5 && lure[k] !== it.answer) return lure[k] as 1 | 2 | 3 | 4;
      const wrong = [1, 2, 3, 4].filter((o) => o !== it.answer);
      return wrong[Math.floor(rng() * 3)] as 1 | 2 | 3 | 4;
    });
  }
  return { name: `สุ่ม ${seed}`, examId: uuid('e' + String(seed).padStart(3, '0'), seed), studentCount: opts.students, items, sets, answers,
    unresolved: seats.filter((_, i) => i % 7 === 3) };
}

export const RANDOM_SPECS = [
  { seed: 11, items: 30, sets: 3, students: 35, scanned: 33 },
  { seed: 12, items: 45, sets: 4, students: 60, scanned: 60 },
  { seed: 13, items: 10, sets: 1, students: 8, scanned: 7 },
  { seed: 14, items: 20, sets: 2, students: 15, scanned: 5 },     // n < r_min_n → ไม่มี r
  { seed: 15, items: 12, sets: 5, students: 50, scanned: 49 },
  { seed: 16, items: 6, sets: 2, students: 4, scanned: 0 },       // ยังไม่มีใครตรวจ
  { seed: 17, items: 25, sets: 3, students: 20, scanned: 20 },
  { seed: 18, items: 15, sets: 2, students: 11, scanned: 6 },     // n = r_min_n พอดี
];
