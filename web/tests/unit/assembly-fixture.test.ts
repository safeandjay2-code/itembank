// สร้างไฟล์ fixture ให้ชุดทดสอบฐานข้อมูล (tests/db/test_phase3.sql): คลังจำลอง + แผนชุดข้อสอบที่สร้างด้วยอัลกอริทึมจริง
// ฐานข้อมูลต้องรับแผนเหล่านี้ทั้งหมด → ยืนยันว่าตัวสร้าง (หน้าเว็บ) และตัวตรวจ (ฐานข้อมูล) ใช้กฎตรงกัน
// แก้อัลกอริทึมแล้วไฟล์ไม่ตรง: รัน UPDATE_FIXTURE=1 npx vitest run tests/unit/assembly-fixture.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import curriculum from '../../../data/curriculum/math_2560_terminal_p4_p6.json';
import levels from '../../../data/levels.json';
import { buildIndicators } from '../../src/data/memoryRepo';
import type { AssemblyRow, PoolItem } from '../../src/core/types';
import { DEFAULT_CONFIG, buildPlan, makeOrdering, type AssemblyRequest } from '../../src/modules/assembly/assemble';
import { validatePlan } from '../../src/modules/assembly/validate';
import { planToCreateInput, toDbPayload } from '../../src/modules/assembly/payload';
import { makeRng } from '../../src/modules/assembly/rng';

const FIXTURE = join(__dirname, '../../../tests/db/fixtures/phase3_plans.json');

function uuid(k: number) { return `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`; }

function generate() {
  const indicators = buildIndicators().filter((i) => i.gradeId === 'P5').slice(0, 4);
  const grades = curriculum.grades.map((g: any) => ({ id: g.id, nameTh: g.name_th, shortTh: g.short_th, sort: g.sort }));
  const diffs = levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));
  const ordering = makeOrdering(buildIndicators(), grades, diffs);
  const rng = makeRng(3);
  const pool: PoolItem[] = [];
  let k = 0;
  for (const ind of indicators)
    for (const d of diffs)
      for (let j = 0; j < 5; j++) {
        k += 1;
        const anchor = j < 2;
        pool.push({ id: uuid(k), itemCode: `M-9${String(k).padStart(5, '0')}`, indicatorId: ind.id, difficulty: d.id, version: 1,
          n: anchor ? 60 + j : j * 3, noShuffle: k % 7 === 0, answer: 1 + Math.floor(rng() * 4), isSample: false });
      }
  const plans = [];
  for (let t = 0; t < 12; t++) {
    const rows: AssemblyRow[] = [];
    for (const ind of indicators)
      for (const d of diffs)
        if (rng() < 0.6) rows.push({ indicatorId: ind.id, difficulty: d.id, count: 1 + Math.floor(rng() * 5) });
    if (!rows.length) rows.push({ indicatorId: indicators[0].id, difficulty: 1, count: 2 });
    const req: AssemblyRequest = { gradeId: 'P5', itemCount: rows.reduce((a, r) => a + r.count, 0),
      setCount: 1 + (t % 10), studentCount: 5 + t * 4, rows };
    const plan = buildPlan(req, pool, DEFAULT_CONFIG, ordering, 1000 + t);
    expect(validatePlan(plan, req, pool, DEFAULT_CONFIG, ordering)).toEqual([]);
    plans.push(toDbPayload(planToCreateInput(plan, req, { title: `ชุดทดสอบ ${t + 1}`, subjectId: 'MATH' })));
  }
  return { note: 'สร้างโดย web/tests/unit/assembly-fixture.test.ts — ห้ามแก้ด้วยมือ', pool: pool.map((p) => ({
    id: p.id, item_code: p.itemCode, indicator_id: p.indicatorId, difficulty: p.difficulty, n: p.n, no_shuffle: p.noShuffle, answer: p.answer })), plans };
}

describe('fixture แผนชุดข้อสอบสำหรับทดสอบฐานข้อมูล', () => {
  it('ไฟล์ตรงกับผลของอัลกอริทึมปัจจุบัน', () => {
    const text = JSON.stringify(generate(), null, 1) + '\n';
    if (process.env.UPDATE_FIXTURE || !existsSync(FIXTURE)) writeFileSync(FIXTURE, text);
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
  });
});
