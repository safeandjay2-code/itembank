// แปลงผลจริงจาก PostgreSQL (migration 0010) เป็นชนิดข้อมูลของหน้าเว็บ — กันชื่อฟิลด์สองฝั่งไม่ตรงกัน
// ตัวอย่าง: fixtures/phase7_db_samples.json (สถานการณ์ปิดชุดใน tests/db/test_phase7.sql ส่วน ค:
//   ข้อ 1 ปานกลาง→ง่าย p 0.9714 n 70 · ข้อ 2 r −0.71 ต้องแก้ด่วน หยุดสุ่ม · ช่อง ป.4/1 ปานกลาง ขาด)
import { describe, expect, it } from 'vitest';
import samples from './fixtures/phase7_db_samples.json';
import { toBankHealth, toCalibrationRun, toItemCalibrationInfo } from '../../src/modules/calibration/fromDb';
import { calibStats, decide, DEFAULT_CALIBRATION } from '../../src/modules/calibration/calibrate';
import { LEVELS } from './calibrationCases';

describe('ผลจากฐานข้อมูล → หน้าเว็บ', () => {
  it('ผลการปรับจากการปิดชุด (calib_exam_result)', () => {
    const r = toCalibrationRun(samples.calib_exam_result);
    expect(r).toMatchObject({ source: 'exam', examId: '00000000-0000-4000-e700-000000000001', itemsChecked: 3, stopped: 1 });
    expect(r.moved).toEqual([{ itemId: '00000000-0000-4000-c701-000000000001', itemCode: 'M-710001', indicatorId: 'MATH-2560-P4-01',
      indicatorCode: '', gradeId: '', version: undefined, from: 2, to: 1, direction: 'easier', p: 0.9714, n: 70, r: null, movedAt: undefined }]);
    expect(r.flagged[0]).toMatchObject({ itemCode: 'M-710002', flag: 'negative_r', r: -0.7143, nR: 70 });
    expect(r.shortfalls).toEqual([{ indicatorId: 'MATH-2560-P4-01', indicatorCode: 'ค 1.1 ป.4/2', gradeId: 'P4', difficultyId: 2, ready: 1, target: 20,
      draft: undefined, needsFix: undefined, movedOut: undefined }]);
  });

  it('สุขภาพคลัง (bank_health)', () => {
    const h = toBankHealth(samples.bank_health);
    expect(h.settings).toEqual({ target: 20, minNToMove: 50, buffer: 0.05, rFlagBelow: 0.2, rMinN: 50, sameGradeOnly: true, recentDays: 30 });
    expect(h.coverage).toEqual({ cells: 132, full: 0, empty: expect.any(Number), readyTotal: 2, targetTotal: 2640 });
    expect(h.statusCounts).toEqual({ active: 2, needs_fix: 1 });
    expect(h.nBuckets).toEqual({ none: 0, collecting: 0, calibrated: 3 });
    expect(h.flagged).toHaveLength(1);
    expect(h.flagged[0]).toMatchObject({ itemCode: 'M-710002', flag: 'negative_r', status: 'needs_fix', difficulty: 2, nR: 70, n: 70 });
    expect(h.recentMoves[0]).toMatchObject({ itemCode: 'M-710001', indicatorCode: 'ค 1.1 ป.4/2', gradeId: 'P4', from: 2, to: 1, direction: 'easier', n: 70 });
    expect(h.moveTotals).toEqual({ easier: 1, harder: 0, allTime: 1 });
    expect(h.levelMix).toHaveLength(4);
    const moved = h.shortfalls.find((s) => s.indicatorId === 'MATH-2560-P4-01' && s.difficultyId === 2)!;
    expect(moved).toMatchObject({ ready: 1, target: 20, movedOut: 1, needsFix: 1 });
    expect(h.runs[0]).toMatchObject({ source: 'exam', moved: 1, flagged: 1, shortfalls: 1, itemsChecked: 3 });
  });

  it('ข้อมูลรายข้อ (calib_item_info) และผลตัดสินตรงกับการคำนวณฝั่งหน้าเว็บ', () => {
    const info = toItemCalibrationInfo(samples.calib_item_info);
    expect(info.stats).toMatchObject({ n: 70, nCorrect: 68, nR: 70, rSumMilli: 20000, p: 0.9714, r: 0.2857, rounds: 2, gradeId: 'P4', version: 1 });
    expect(info.moves[0]).toMatchObject({ from: 2, to: 1, direction: 'easier', p: 0.9714, n: 70, version: 1 });
    expect(info.rounds).toHaveLength(2);
    // คำนวณซ้ำจากรอบสอบดิบด้วยโมดูลหน้าเว็บ ต้องได้สถิติเท่ากับฐานข้อมูล
    const st = calibStats(info.rounds, 1, 'P4', DEFAULT_CALIBRATION);
    expect(st).toMatchObject({ n: 70, nCorrect: 68, nR: 70, rSumMilli: 20000, p: 0.9714, r: 0.2857 });
    // ย้ายเป็นง่ายแล้ว → ผลตัดสินปัจจุบันไม่ย้ายต่อ
    expect(decide(LEVELS, DEFAULT_CALIBRATION, 1, st)).toEqual(info.decision);
  });

  it('สั่งปรับซ้ำ (calib_run) ด้วยข้อมูลเดิม: ไม่มีอะไรเปลี่ยน', () => {
    const r = toCalibrationRun(samples.calib_run);
    expect(r).toMatchObject({ source: 'manual', examId: null, itemsChecked: 3, moved: [], flagged: [], unflagged: [], shortfalls: [], stopped: 0 });
  });
});
