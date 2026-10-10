// ทดสอบวงจรปรับความยาก (SPEC §11): เกณฑ์ n, ช่วงกันชน, ปลายทางของการย้าย, ป้าย r, การจำลองสอบหลายรอบ
import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/modules/assembly/rng';
import {
  applyCalibration, calibStats, calibrationConfigFromSettings, decide, DEFAULT_CALIBRATION, levelForP, roundHalfAway,
} from '../../src/modules/calibration/calibrate';
import settingsList from '../../../data/settings.default.json';
import { cfgOf, KNOWN, LEVELS, rSumMilli, simulations, EASY, MEDIUM, HARD, CHALLENGE } from './calibrationCases';

const bounds = Object.fromEntries(LEVELS.map((d) => [d.id, d]));

describe('ตัดสินการย้ายระดับและป้าย r (กรณีที่รู้คำตอบ)', () => {
  for (const c of KNOWN) {
    it(c.name, () => {
      const d = decide(LEVELS, cfgOf(c.cfg), c.current, { n: c.n, nCorrect: c.nc, nR: c.nR ?? 0, rSumMilli: rSumMilli(c.r, c.nR) });
      expect(d).toEqual(c.expect);
    });
  }
});

describe('ค่าตั้งต้นมาจากตารางตั้งค่า', () => {
  it('อ่านเกณฑ์จาก settings.default.json ตรงกับ SPEC §11', () => {
    const s = Object.fromEntries(settingsList.map((x) => [x.key, x.value]));
    expect(calibrationConfigFromSettings(s)).toEqual({ minNToMove: 50, buffer: 0.05, rMinN: 50, rFlagBelow: 0.2, sameGradeOnly: true, target: 20 });
  });
});

describe('ระดับที่ค่า p ตกอยู่', () => {
  it('ง่าย > 0.80 · ปานกลาง 0.50–0.80 · ยาก 0.25–0.50 · ท้าทาย < 0.25', () => {
    expect(levelForP(LEVELS, 100, 81)).toBe(EASY);
    expect(levelForP(LEVELS, 100, 80)).toBe(MEDIUM);
    expect(levelForP(LEVELS, 100, 51)).toBe(MEDIUM);
    expect(levelForP(LEVELS, 100, 50)).toBe(HARD);
    expect(levelForP(LEVELS, 100, 26)).toBe(HARD);
    expect(levelForP(LEVELS, 100, 25)).toBe(CHALLENGE);
    expect(levelForP(LEVELS, 100, 0)).toBe(CHALLENGE);
  });
});

describe('สถิติที่ใช้ตัดสิน', () => {
  const rounds = [
    { version: 1, gradeId: 'P5', n: 30, nCorrect: 20, r: 0.4 },
    { version: 1, gradeId: 'P6', n: 40, nCorrect: 39, r: 0.1 },   // ชั้นอื่น
    { version: 1, gradeId: 'P5', n: 25, nCorrect: 10, r: null },   // ไม่มี r (ห้องเล็ก)
    { version: 2, gradeId: 'P5', n: 50, nCorrect: 50, r: 0.9 },    // เวอร์ชันใหม่ ไม่เกี่ยว
    { version: 1, gradeId: 'P5', n: 20, nCorrect: 5, r: -0.1 },
  ];
  it('นับเฉพาะเวอร์ชันปัจจุบันและชั้นของตัวชี้วัด r ถ่วงด้วย n', () => {
    const s = calibStats(rounds, 1, 'P5', DEFAULT_CALIBRATION);
    expect(s).toMatchObject({ n: 75, nCorrect: 35, nR: 50, rSumMilli: 400 * 30 - 100 * 20, rounds: 3 });
    expect(s.p).toBeCloseTo(35 / 75, 4);
    expect(s.r).toBeCloseTo((0.4 * 30 - 0.1 * 20) / 50, 4);
  });
  it('ปิด "นับเฉพาะชั้นเดียวกัน" → นับทุกชั้น', () => {
    const s = calibStats(rounds, 1, 'P5', { ...DEFAULT_CALIBRATION, sameGradeOnly: false });
    expect(s).toMatchObject({ n: 115, nCorrect: 74, nR: 90, rounds: 4 });
  });
  it('ปัดแบบเดียวกับ PostgreSQL (.5 ออกจากศูนย์)', () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway((0.8 - 0.05) * 1e6)).toBe(750000);
    expect(roundHalfAway(-0.667 * 1000)).toBe(-667);
  });
});

describe('สุ่ม 20,000 กรณี: ผลตรงกับกฎที่เขียนด้วยทศนิยม (ห่างจากเส้น)', () => {
  it('ย้ายเฉพาะเมื่อ n ถึงเกณฑ์และหลุดกันชน ปลายทางมี p อยู่ในช่วง', () => {
    const rng = makeRng(7);
    let moves = 0;
    for (let t = 0; t < 20000; t++) {
      const cfg = cfgOf({ buffer: [0, 0.05, 0.1][t % 3], minNToMove: [30, 50][t % 2] });
      const cur = 1 + Math.floor(rng() * 4);
      const n = Math.floor(rng() * 120);
      const nc = Math.floor(rng() * (n + 1));
      const d = decide(LEVELS, cfg, cur, { n, nCorrect: nc, nR: 0, rSumMilli: 0 });
      const p = n ? nc / n : 0;
      const b = bounds[cur];
      if (n < cfg.minNToMove) { expect(d.target).toBeNull(); continue; }
      const near = (x: number) => Math.abs(p - x) < 1e-9;
      if (near(b.pLower - cfg.buffer) || near(b.pUpper + cfg.buffer)) continue;
      const down = b.pLower > 0 && p < b.pLower - cfg.buffer;
      const up = b.pUpper < 1 && p > b.pUpper + cfg.buffer;
      if (!down && !up) { expect(d.target).toBeNull(); continue; }
      moves++;
      expect(d.direction).toBe(down ? 'harder' : 'easier');
      const tb = bounds[d.target!];
      expect(p > tb.pLower || tb.pLower === 0).toBe(true);
      expect(p <= tb.pUpper).toBe(true);
      expect(down ? d.target! > cur : d.target! < cur).toBe(true);
    }
    expect(moves).toBeGreaterThan(3000);
  });
});

describe('ปรับ 1 ข้อ', () => {
  const base = { currentDifficulty: MEDIUM, status: 'active', qualityFlag: null, currentVersion: 1, gradeId: 'P4' } as const;
  const r50 = (r: number) => [{ version: 1, gradeId: 'P4', n: 50, nCorrect: 30, r }];
  it('r ติดลบ → ต้องแก้ด่วน + เปลี่ยนสถานะเป็น "ต้องแก้" (หยุดสุ่ม)', () => {
    const res = applyCalibration(LEVELS, DEFAULT_CALIBRATION, { ...base }, r50(-0.2))!;
    expect(res.state).toMatchObject({ qualityFlag: 'negative_r', status: 'needs_fix' });
    expect(res.stopped).toBe(true);
  });
  it('r ต่ำ → ติดป้ายแต่สถานะคงเดิม (ยังสุ่มเข้าชุดได้)', () => {
    const res = applyCalibration(LEVELS, DEFAULT_CALIBRATION, { ...base }, r50(0.1))!;
    expect(res.state).toMatchObject({ qualityFlag: 'low_r', status: 'active' });
  });
  it('ครูตั้งสถานะกลับเองแล้ว ข้อมูลเดิมไม่บังคับหยุดซ้ำ', () => {
    const res = applyCalibration(LEVELS, DEFAULT_CALIBRATION, { ...base, qualityFlag: 'negative_r', status: 'reviewed' }, r50(-0.2))!;
    expect(res.state.status).toBe('reviewed');
    expect(res.flagChanged).toBeNull();
  });
  it('r ดีขึ้น → ป้ายหายเอง', () => {
    const res = applyCalibration(LEVELS, DEFAULT_CALIBRATION, { ...base, qualityFlag: 'low_r' }, r50(0.35))!;
    expect(res.state.qualityFlag).toBeNull();
    expect(res.flagChanged).toEqual({ from: 'low_r', to: null });
  });
  it('ร่างและเลิกใช้ไม่ถูกปรับ', () => {
    expect(applyCalibration(LEVELS, DEFAULT_CALIBRATION, { ...base, status: 'draft' }, r50(-0.5))).toBeNull();
    expect(applyCalibration(LEVELS, DEFAULT_CALIBRATION, { ...base, status: 'retired' }, r50(-0.5))).toBeNull();
  });
});

describe('จำลองสอบหลายรอบ (SPEC §13 เฟส 7)', () => {
  const sims = simulations();
  it('มีการย้ายจริงทั้งขึ้นและลง และมีทั้งป้าย r ต่ำและ r ติดลบ', () => {
    const all = sims.flatMap((s) => s.steps);
    expect(all.filter((x) => x.moved).length).toBeGreaterThanOrEqual(6);
    expect(all.some((x) => x.flag === 'negative_r' && x.status === 'needs_fix')).toBe(true);
    expect(all.some((x) => x.flag === 'low_r')).toBe(true);
  });
  for (const s of sims) {
    it(`${s.name}: ทุกการย้ายถูกตามเกณฑ์ n และกันชน`, () => {
      let level = s.start;
      let version = 1;
      for (let i = 0; i < s.steps.length; i++) {
        if (s.rounds[i].bumpVersion) version += 1;
        const st = calibStats(s.rounds.slice(0, i + 1), version, s.gradeId, s.cfg);
        const step = s.steps[i];
        const p = st.n ? st.nCorrect / st.n : 0;
        if (step.difficulty !== level) {
          expect(st.n).toBeGreaterThanOrEqual(s.cfg.minNToMove);
          const b = bounds[level];
          if (step.difficulty > level) expect(p).toBeLessThan(b.pLower - s.cfg.buffer + 1e-12);
          else expect(p).toBeGreaterThan(b.pUpper + s.cfg.buffer - 1e-12);
          expect(levelForP(LEVELS, st.n, st.nCorrect)).toBe(step.difficulty);
        } else if (st.n >= s.cfg.minNToMove) {
          const b = bounds[level];
          expect(b.pLower === 0 || p >= b.pLower - s.cfg.buffer - 1e-12).toBe(true);
          expect(b.pUpper === 1 || p <= b.pUpper + s.cfg.buffer + 1e-12).toBe(true);
        }
        if (s.rounds[i].bumpVersion) expect(st.rounds).toBe(1);
        level = step.difficulty;
      }
    });
  }
  it('ข้อง่ายจริงที่วางไว้ปานกลางขึ้นเป็นง่าย · ข้อที่ครูคาดว่าง่ายแต่จริงยากลงเป็นยาก · ข้อใกล้เส้นไม่แกว่ง', () => {
    expect(sims[0].steps.at(-1)!.difficulty).toBe(EASY);
    expect(sims[1].steps.at(-1)!.difficulty).toBe(HARD);
    expect(sims[2].steps.at(-1)!.difficulty).toBe(CHALLENGE);
    const flips = (k: number) => sims[k].steps.filter((x) => x.moved).length;
    expect(flips(3)).toBeLessThanOrEqual(1);
    expect(flips(4)).toBeLessThanOrEqual(1);
  });
  it('r ติดลบ → หยุดสุ่ม (ไม่มีรอบสอบหลังจากนั้น)', () => {
    const s = sims[5];
    expect(s.steps.at(-1)).toMatchObject({ flag: 'negative_r', status: 'needs_fix' });
    expect(s.rounds.length).toBeLessThan(10);
  });
  it('ขึ้นเวอร์ชันใหม่ → ป้ายเดิมหาย เริ่มนับใหม่', () => {
    const s = sims[8];
    const before = s.steps[4], after = s.steps[5];
    expect(before.flag).toBe('low_r');
    expect(after.flag).toBeNull();
  });
});
