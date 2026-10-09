import { describe, it, expect } from 'vitest';
import { cellState, summarizeCoverage } from '../../src/modules/bank/coverage';
import { buildIndicators, MemoryRepo } from '../../src/data/memoryRepo';

describe('หลักสูตร', () => {
  it('ตัวชี้วัดปลายทาง 10/10/13 และ id ตรงกับ seed ฐานข้อมูล', () => {
    const inds = buildIndicators();
    const c = (g: string) => inds.filter((i) => i.gradeId === g).length;
    expect([c('P4'), c('P5'), c('P6')]).toEqual([10, 10, 13]);
    expect(inds[0].id).toBe('MATH-2560-P4-01');
    expect(new Set(inds.map((i) => i.id)).size).toBe(33);
  });
});

describe('ผังความครบ', () => {
  it('สถานะช่อง', () => {
    expect(cellState(0, 20)).toBe('none');
    expect(cellState(5, 20)).toBe('low');
    expect(cellState(20, 20)).toBe('full');
    expect(cellState(25, 20)).toBe('full');
  });
  it('สรุปผลด้วยข้อหุ่น 2 ข้อต่อช่อง', async () => {
    const repo = new MemoryRepo(2);
    const inds = await repo.getIndicators('MATH');
    const s = summarizeCoverage(inds, await repo.getCoverage('MATH'), 20);
    expect(s.target).toBe(2640);
    expect(s.ready).toBe(264);
    expect(s.percent).toBe(10);
    expect(s.shortCells).toBe(132);
  });
  it('เกินเป้าไม่ทำให้ % เกินจริง', () => {
    const inds = buildIndicators().slice(0, 1);
    const cells = [1, 2, 3, 4].map((d) => ({ indicatorId: inds[0].id, difficultyId: d, ready: d === 1 ? 50 : 0, draft: 0, needsFix: 0 }));
    expect(summarizeCoverage(inds, cells, 20).percent).toBe(25);
  });
});
