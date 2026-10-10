// สร้าง fixture ให้ชุดทดสอบฐานข้อมูล (tests/db/test_phase7.sql): กรณีขอบที่รู้คำตอบ + การจำลองสอบหลายรอบ
// ฐานข้อมูลต้องตัดสิน (calib_decide) และพาข้อเดินตามรอบสอบ (ทริกเกอร์หลังบันทึกสถิติ) ได้ผลเดียวกับหน้าเว็บทุกขั้น
// แก้กฎแล้วไฟล์ไม่ตรง: รัน UPDATE_FIXTURE=1 npx vitest run tests/unit/calibration-fixture.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decide } from '../../src/modules/calibration/calibrate';
import { cfgOf, KNOWN, LEVELS, rSumMilli, simulations } from './calibrationCases';
import type { CalibrationConfig } from '../../src/modules/calibration/calibrate';

const FIXTURE = join(__dirname, '../../../tests/db/fixtures/phase7_calibration.json');
const settings = (c: CalibrationConfig) => ({ 'calibration.min_n_to_move': c.minNToMove, 'calibration.buffer': c.buffer,
  'calibration.r_min_n': c.rMinN, 'calibration.r_flag_below': c.rFlagBelow, 'calibration.same_grade_only': c.sameGradeOnly });

function generate() {
  const known = KNOWN.map((k) => {
    const cfg = cfgOf(k.cfg);
    const st = { n: k.n, nCorrect: k.nc, nR: k.nR ?? 0, rSumMilli: rSumMilli(k.r, k.nR) };
    const d = decide(LEVELS, cfg, k.current, st);
    return { name: k.name, settings: settings(cfg), current: k.current, n: st.n, n_correct: st.nCorrect, n_r: st.nR, r_sum_milli: st.rSumMilli,
      expected: { target: d.target, direction: d.direction, flag: d.flag } };
  });
  const sims = simulations().map((s) => ({
    name: s.name, item_id: s.itemId, grade_id: s.gradeId, start: s.start, settings: settings(s.cfg),
    rounds: s.rounds.map((r, i) => ({ version: r.version, grade_id: r.gradeId, n: r.n, n_correct: r.nCorrect, r: r.r, bump: !!r.bumpVersion,
      expected: { difficulty: s.steps[i].difficulty, flag: s.steps[i].flag, status: s.steps[i].status, moved: s.steps[i].moved } })),
  }));
  return { note: 'สร้างโดย web/tests/unit/calibration-fixture.test.ts — ห้ามแก้ด้วยมือ', known, simulations: sims };
}

describe('fixture วงจรปรับความยากสำหรับทดสอบฐานข้อมูล', () => {
  it('ไฟล์ตรงกับกฎปัจจุบัน', () => {
    const text = JSON.stringify(generate(), null, 1) + '\n';
    if (process.env.UPDATE_FIXTURE || !existsSync(FIXTURE)) writeFileSync(FIXTURE, text);
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
  });
});
