// สร้าง fixture ให้ชุดทดสอบฐานข้อมูล (tests/db/test_phase6.sql): ชุดข้อสอบ + ผลตรวจ + ผลวิเคราะห์ที่หน้าเว็บคำนวณ
// ฐานข้อมูลต้องคำนวณสถิติรายข้อ (ที่จะเก็บเข้าคลัง) และภาพรวมห้องได้ตรงกันทุกค่า
// แก้การวิเคราะห์แล้วไฟล์ไม่ตรง: รัน UPDATE_FIXTURE=1 npx vitest run tests/unit/analysis-fixture.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../../src/modules/analysis/analyze';
import { knownCase, randomCase, RANDOM_SPECS, toExam, toResponses, type Case } from './analysisCases';

const FIXTURE = join(__dirname, '../../../tests/db/fixtures/phase6_analysis.json');

function dump(c: Case) {
  const exam = toExam(c);
  const resp = toResponses(c);
  const a = analyze(exam, resp);
  return {
    name: c.name,
    exam: { id: exam.id, item_count: exam.itemCount, set_count: exam.setCount, student_count: exam.studentCount },
    items: exam.items.map((i) => ({ id: i.itemId, item_code: i.itemCode, indicator_id: i.indicatorId, difficulty: i.difficulty,
      base_position: i.basePosition, answer: i.answer })),
    sets: exam.sets.map((s) => ({ set_no: s.setNo, entries: s.entries.map((e) => ({ item_id: e.itemId, option_order: e.optionOrder })) })),
    responses: resp.map((r) => ({ seat_no: r.seatNo, set_no: r.setNo, answers: r.answers, flags: r.flags, score: r.score })),
    expected: {
      items: a.items.map((i) => ({ item_id: i.itemId, n: i.n, n_correct: i.nCorrect, p: i.p, r: i.r, group_size: i.groupSize,
        upper_correct: i.upperCorrect, lower_correct: i.lowerCorrect, option_counts: i.counts })),
      summary: { n: a.summary.n, mean: a.summary.mean, sd: a.summary.sd, median: a.summary.median, min: a.summary.min, max: a.summary.max,
        mean_percent: a.summary.meanPercent, histogram: a.summary.histogram,
        indicators: a.indicators.map((x) => ({ indicator_id: x.indicatorId, item_count: x.itemCount, pass_count: x.passCount, mean_ratio: x.meanRatio })) },
    },
  };
}

function generate() {
  return { note: 'สร้างโดย web/tests/unit/analysis-fixture.test.ts — ห้ามแก้ด้วยมือ', cases: [knownCase(), ...RANDOM_SPECS.map((s) => randomCase(s.seed, s))].map(dump) };
}

describe('fixture ผลวิเคราะห์สำหรับทดสอบฐานข้อมูล', () => {
  it('ไฟล์ตรงกับผลของการวิเคราะห์ปัจจุบัน', () => {
    const text = JSON.stringify(generate(), null, 1) + '\n';
    if (process.env.UPDATE_FIXTURE || !existsSync(FIXTURE)) writeFileSync(FIXTURE, text);
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
  });
});
