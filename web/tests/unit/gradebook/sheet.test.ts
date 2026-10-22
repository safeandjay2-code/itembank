// One Stop เฟส 4: คำนวณสมุดคะแนน (computeSheet เลียนแบบ gb_sheet)
//   ใช้สถานการณ์และค่าที่คำนวณมือชุดเดียวกับ tests/db/test_phase8.sql หัวข้อ ค) และ ง) — ผลต้องตรงกับฐานข้อมูลจริงทุกค่า
import { describe, expect, it } from 'vitest';
import type { GbAttempt, GbColumn, GbSettings, GbSheet } from '../../../src/core/types';
import {
  belowPass, columnHead, columnStats, computeSheet, parseAdjust, passScore, roundHalfUp, seatDetail, uncollectedColumns, type SheetInput,
} from '../../../src/modules/gradebook/sheet';

const A = 'MATH-2560-P5-01', B = 'MATH-2560-P5-02', C = 'MATH-2560-P5-03';
const IND: Record<string, { code: string; text: string }> = {
  [A]: { code: 'ค 1.1 ป.5/8', text: 'ตัวชี้วัด A' }, [B]: { code: 'ค 1.1 ป.5/9', text: 'ตัวชี้วัด B' }, [C]: { code: 'ค 2.1 ป.5/1', text: 'ตัวชี้วัด C' },
};
const DEFAULT: Required<GbSettings> = { rounding: 'int', aggregation: 'sum', retake_policy: 'max', absent_policy: 'zero', show_other_columns: false };

/** ผลตรวจรายข้อ → คะแนนจริงรายตัวชี้วัด (เหมือน gb_refresh_attempts) */
function att(examId: string, seatNo: number, items: string[], right: number[]): GbAttempt[] {
  const per = new Map<string, { c: number; t: number }>();
  items.forEach((ind, k) => { const v = per.get(ind) ?? { c: 0, t: 0 }; v.t += 1; if (right.includes(k + 1)) v.c += 1; per.set(ind, v); });
  return [...per].map(([indicatorId, v]) => ({ examId, seatNo, indicatorId, correct: v.c, total: v.t }));
}

const E1_ITEMS = [A, A, A, B, B, B], E2_ITEMS = [A, A], F1_ITEMS = [A, A, A, B, B, B];
function scenario(settings: Partial<GbSettings> = {}, cols?: Partial<Record<string, number | null>>): SheetInput {
  const ex = (id: string, purpose: 'collect' | 'final' | 'practice', items: string[], retakeOf: string | null, t: number) =>
    ({ id, title: id, purpose, retakeOf, status: 'open' as const, createdAt: `2026-10-0${t}T00:00:00Z`, itemIndicators: items });
  const columns: GbColumn[] = [
    { id: 1, kind: 'final', indicatorId: null, label: null, maxScore: 30, sort: 0 },
    { id: 2, kind: 'indicator', indicatorId: A, label: null, maxScore: cols && A in cols ? cols[A]! : 10, sort: 1 },
    { id: 3, kind: 'indicator', indicatorId: B, label: null, maxScore: 20, sort: 2 },
    { id: 4, kind: 'other', indicatorId: null, label: 'งานกลุ่ม', maxScore: 5, sort: 3 },
  ];
  return {
    classroom: { id: 'k', name: 'ป.5/1', subjectId: 'MATH', gradeId: 'P5', academicYear: 2569, term: 2, studentCount: 5, status: 'open',
      settings: { ...DEFAULT, ...settings } },
    columns, indicator: (id) => IND[id],
    exams: [ex('E1', 'collect', E1_ITEMS, null, 1), ex('E2', 'collect', E2_ITEMS, null, 2), ex('R1', 'collect', E1_ITEMS, 'E1', 3),
      ex('F1', 'final', F1_ITEMS, null, 4), ex('E3', 'collect', [C], null, 5), ex('D1', 'collect', [A], null, 6)],
    attempts: [
      ...att('E1', 1, E1_ITEMS, [1, 2, 3, 4, 5, 6]), ...att('E1', 2, E1_ITEMS, [1, 2, 4]), ...att('E1', 3, E1_ITEMS, [4, 5, 6]), ...att('E1', 5, E1_ITEMS, [1]),
      ...att('E2', 1, E2_ITEMS, [1, 2]), ...att('E2', 2, E2_ITEMS, [1, 2]), ...att('E2', 3, E2_ITEMS, []), ...att('E2', 4, E2_ITEMS, [1, 2]),
      ...att('R1', 3, E1_ITEMS, [1, 2, 3]), ...att('R1', 5, E1_ITEMS, [1, 2]),
      ...att('F1', 1, F1_ITEMS, [1, 2, 3, 4, 5, 6]), ...att('F1', 2, F1_ITEMS, [1, 2, 3]),
    ],
    overrides: [], retakeChoices: [],
  };
}
const idx = (s: GbSheet, key: string) => s.columns.findIndex((c) => (c.indicatorId ?? c.label ?? c.kind) === key);
const vals = (s: GbSheet, key: string, f: 'value' | 'real' | 'rawCorrect' = 'value') =>
  s.rows.map((r) => r.cells[idx(s, key)][f]).map((v) => (v === null ? '-' : String(v))).join(' ');

describe('computeSheet = gb_sheet (ค่าเดียวกับ test_phase8.sql)', () => {
  it('ค่าเริ่มต้น: บวกตรง · สอบซ่อมสูงสุด · ขาดสอบ 0 · ปัดจำนวนเต็ม', () => {
    const s = computeSheet(scenario());
    expect(vals(s, A)).toBe('10 8 6 4 4');
    expect(vals(s, B)).toBe('20 7 20 0 0');
    expect(vals(s, 'final')).toBe('30 15 0 0 0');
    expect(vals(s, 'งานกลุ่ม')).toBe('- - - - -');
    expect(vals(s, B, 'real')).toBe('20 6.67 20 0 0');
    expect(vals(s, A, 'rawCorrect')).toBe('5 4 3 2 2');
    expect(s.rows[0].cells[idx(s, A)].rawTotal).toBe(5);
    expect(s.rows[3].cells[idx(s, A)].missing).toEqual(['E1']);
    expect(s.rows[4].cells[idx(s, A)].missing).toEqual(['E2']);
    expect(s.rows[0]).toMatchObject({ totalCollect: 30, totalFinal: 30, total: 60 });
    expect(s.columns[0].groups).toHaveLength(2);   // ชุดที่ยังไม่สอบ (D1) ไม่นับ
    expect(s.columns.map((c) => c.kind)).toEqual(['indicator', 'indicator', 'other', 'final']);
    expect(s.columns[0]).toMatchObject({ standardCode: 'ค 1.1', indicatorCode: 'ป.5/8', collected: true });
    expect(s.totals).toEqual({ collectMax: 35, finalMax: 30, max: 65, unsetColumns: 0 });
    expect(s.unplannedIndicators).toEqual([]);
  });

  it('สอบซ่อม: ล่าสุด / เฉลี่ย / ครูเลือก', () => {
    let s = computeSheet(scenario({ retake_policy: 'latest' }));
    expect(vals(s, A)).toBe('10 8 6 4 4');
    expect(vals(s, B)).toBe('20 7 0 0 0');
    s = computeSheet(scenario({ retake_policy: 'mean' }));
    expect(vals(s, A)).toBe('10 8 3 4 3');
    expect(vals(s, B)).toBe('20 7 10 0 0');
    const inp = scenario({ retake_policy: 'manual' });
    inp.retakeChoices = [{ rootExamId: 'E1', seatNo: 3, chosenExamId: 'E1' }];
    s = computeSheet(inp);
    expect(vals(s, A)).toBe('10 8 0 4 4');
    expect(vals(s, B)).toBe('20 7 20 0 0');
  });

  it('เฉลี่ยแต่ละครั้ง · ขาดสอบไม่นับ · ทศนิยม 1 ตำแหน่ง · แก้คะแนนเต็ม · ยังไม่ตั้งคะแนนเต็ม', () => {
    expect(vals(computeSheet(scenario({ aggregation: 'mean' })), A)).toBe('10 8 5 5 3');
    const skip = computeSheet(scenario({ absent_policy: 'skip' }));
    expect(vals(skip, A)).toBe('10 8 6 10 7');
    expect(vals(skip, 'final')).toBe('30 15 - - -');
    expect(vals(computeSheet(scenario({ rounding: '1dp' })), B)).toBe('20 6.7 20 0 0');
    expect(vals(computeSheet(scenario({}, { [A]: 7 })), A)).toBe('7 6 4 3 3');
    expect(vals(computeSheet(scenario({}, { [A]: 12.5 })), A)).toBe('13 10 8 5 5');
    const unset = computeSheet(scenario({}, { [A]: null }));
    expect(vals(unset, A)).toBe('- - - - -');
    expect(vals(unset, A, 'rawCorrect')).toBe('5 4 3 2 2');
    expect(unset.totals.unsetColumns).toBe(1);
  });

  it('ตัวชี้วัดที่ยังไม่มีช่อง · คะแนนที่ปรับแยกจากคะแนนจริง', () => {
    const inp = scenario();
    inp.attempts.push(...att('E3', 1, [C], [1]));
    expect(computeSheet(inp).unplannedIndicators).toEqual([C]);
    inp.overrides = [{ columnId: 2, seatNo: 4, score: 5, reason: 'pass' }, { columnId: 4, seatNo: 2, score: 4, reason: 'manual' }];
    const s = computeSheet(inp);
    expect(s.rows[3].cells[idx(s, A)]).toMatchObject({ value: 5, real: 4, adjusted: 5, reason: 'pass' });
    expect(vals(s, 'งานกลุ่ม')).toBe('- 4 - - -');
    expect(s.rows[3].totalCollect).toBe(5 + 0);   // P5-01 ปรับเป็น 5 + P5-02 0
  });

  it('ห้องที่ยังไม่มีผลสอบ: ทุกช่องว่าง ยังไม่เก็บคะแนน', () => {
    const inp = scenario();
    inp.attempts = [];
    const s = computeSheet(inp);
    expect(s.rows).toHaveLength(5);
    expect(s.rows.every((r) => r.total === null)).toBe(true);
    expect(uncollectedColumns(s).map((c) => c.kind)).toEqual(['indicator', 'indicator', 'final']);
  });
});

describe('ตรรกะหน้าสมุดคะแนน', () => {
  it('ปัดครึ่งขึ้นแบบฐานข้อมูล (กันเศษเลขฐานสอง)', () => {
    expect(roundHalfUp(5.5, 0)).toBe(6);
    expect(roundHalfUp(2.5, 0)).toBe(3);
    expect(roundHalfUp(0.35 * 10, 0)).toBe(4);
    expect(roundHalfUp(6.666666, 1)).toBe(6.7);
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
  });
  it('คะแนนผ่าน = เต็ม × เกณฑ์ ปัดขึ้น · ต่ำกว่าเกณฑ์ใช้คะแนนจริง', () => {
    expect(passScore(10, 0.5, 'int')).toBe(5);
    expect(passScore(9, 0.5, 'int')).toBe(5);
    expect(passScore(9, 0.5, '1dp')).toBe(4.5);
    expect(passScore(7, 0.5, '1dp')).toBe(3.5);
    expect(passScore(null, 0.5, 'int')).toBeNull();
    const cell = { columnId: 1, rawCorrect: 2, rawTotal: 5, real: 4, adjusted: null, reason: null, value: 4, missing: [] };
    expect(belowPass(cell, 10, 0.5)).toBe(true);
    expect(belowPass({ ...cell, real: 5 }, 10, 0.5)).toBe(false);
    expect(belowPass({ ...cell, real: null }, 10, 0.5)).toBe(false);
  });
  it('สถิติช่อง: เฉลี่ย ต่ำกว่าเกณฑ์ ปรับแล้ว ขาดสอบ', () => {
    const inp = scenario();
    inp.overrides = [{ columnId: 2, seatNo: 4, score: 5, reason: 'pass' }];
    const s = computeSheet(inp);
    // P5-01 = 10 8 6 5(ปรับ) 4 → เฉลี่ย 6.6 · ต่ำกว่า 5: เลขที่ 5 (4) — เลขที่ 4 ปรับแล้วไม่นับ · ขาดสอบ: 4, 5
    expect(columnStats(s, idx(s, A), 0.5)).toEqual({ n: 5, mean: 6.6, below: 1, adjusted: 1, absent: 2 });
  });
  it('รายละเอียดรายคน: ครั้งที่สอบ คะแนน ครั้งที่นับ', () => {
    const s = computeSheet(scenario());
    const g = seatDetail(s, 2, 3);   // เลขที่ 3 ช่อง P5-01
    expect(g.map((x) => x.root)).toEqual(['E1', 'E2']);
    expect(g[0].attempts.map((a) => `${a.examId}:${a.correct}/${a.total}:${a.counted}`)).toEqual(['E1:0/3:false', 'R1:3/3:true']);
    expect(g[1].attempts.map((a) => `${a.examId}:${a.correct}/${a.total}`)).toEqual(['E2:0/2']);
    expect(seatDetail(s, 2, 4)[0]).toMatchObject({ absent: true, attempts: [] });
    expect(seatDetail(s, 1, 2)[0].attempts[0]).toMatchObject({ examId: 'F1', correct: 3, total: 6, counted: true });   // ปลายภาครวมทุกตัวชี้วัด
    const latest = computeSheet(scenario({ retake_policy: 'latest' }));
    expect(seatDetail(latest, 3, 3)[0].attempts.map((a) => a.counted)).toEqual([false, true]);
    const manual = scenario({ retake_policy: 'manual' });
    manual.retakeChoices = [{ rootExamId: 'E1', seatNo: 3, chosenExamId: 'E1' }];
    const m = seatDetail(computeSheet(manual), 2, 3)[0];
    expect(m.chosenExamId).toBe('E1');
    expect(m.attempts.map((a) => a.counted)).toEqual([true, false]);
  });
  it('หัวคอลัมน์ · ตรวจคะแนนที่ปรับ', () => {
    const s = computeSheet(scenario());
    expect(s.columns.map(columnHead)).toEqual([{ top: 'ค 1.1', bottom: 'ป.5/8' }, { top: 'ค 1.1', bottom: 'ป.5/9' },
      { top: 'งานกลุ่ม', bottom: '' }, { top: 'สอบ', bottom: 'ปลายภาค' }]);
    expect(parseAdjust('', 10)).toEqual({ ok: true, value: null });
    expect(parseAdjust('7.5', 10)).toEqual({ ok: true, value: 7.5 });
    expect(parseAdjust('11', 10)).toMatchObject({ ok: false });
    expect(parseAdjust('-1', 10)).toMatchObject({ ok: false });
    expect(parseAdjust('3.333', null)).toMatchObject({ ok: false });
  });
});
