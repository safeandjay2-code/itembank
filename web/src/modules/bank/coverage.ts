// ตรรกะผังความครบของคลัง (แยกจากหน้าจอ เพื่อทดสอบได้)
import type { CoverageCell, Indicator } from '../../core/types';

export type CellState = 'full' | 'low' | 'none';

export function cellState(ready: number, target: number): CellState {
  if (ready <= 0) return 'none';
  return ready >= target ? 'full' : 'low';
}

export interface CoverageSummary {
  indicatorCount: number;
  ready: number;
  target: number;
  percent: number;
  shortCells: number;
}

export function summarizeCoverage(inds: Indicator[], cells: CoverageCell[], perLevelTarget: number): CoverageSummary {
  const ids = new Set(inds.map((i) => i.id));
  const mine = cells.filter((c) => ids.has(c.indicatorId));
  const levels = new Set(mine.map((c) => c.difficultyId)).size || 4;
  const target = inds.length * levels * perLevelTarget;
  // นับข้อพร้อมใช้ไม่เกินเป้าในแต่ละช่อง เพื่อให้ % สะท้อนความครบ ไม่ใช่จำนวนรวม
  const capped = mine.reduce((s, c) => s + Math.min(c.ready, perLevelTarget), 0);
  return {
    indicatorCount: inds.length,
    ready: mine.reduce((s, c) => s + c.ready, 0),
    target,
    percent: target ? Math.round((capped / target) * 1000) / 10 : 0,
    shortCells: mine.filter((c) => c.ready < perLevelTarget).length,
  };
}
