import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import type { CoverageCell, DifficultyLevel, Grade, Indicator } from '../../core/types';
import { cellState, summarizeCoverage } from './coverage';

export function CoveragePage() {
  const [grades, setGrades] = useState<Grade[]>([]);
  const [inds, setInds] = useState<Indicator[]>([]);
  const [levels, setLevels] = useState<DifficultyLevel[]>([]);
  const [cells, setCells] = useState<CoverageCell[]>([]);
  const [target, setTarget] = useState(20);
  const [grade, setGrade] = useState('P4');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [g, i, l, c, s] = await Promise.all([repo.getGrades(), repo.getIndicators('MATH'),
          repo.getDifficultyLevels(), repo.getCoverage('MATH'), repo.getSettings()]);
        setGrades(g); setInds(i); setLevels(l); setCells(c);
        setTarget(Number(s['bank.items_per_level_target'] ?? 20));
      } catch (e) { setError((e as Error).message); }
    })();
  }, []);

  const shown = inds.filter((i) => i.gradeId === grade);
  const byKey = useMemo(() => new Map(cells.map((c) => [`${c.indicatorId}|${c.difficultyId}`, c])), [cells]);
  const sum = summarizeCoverage(shown, cells, target);

  return (
    <>
      <h1>ผังคลังข้อสอบ</h1>
      <p className="sub">จำนวนข้อพร้อมใช้ต่อ ตัวชี้วัดปลายทาง × ระดับความยาก (เป้า {target} ข้อต่อช่อง)</p>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="tabs" role="group" aria-label="เลือกชั้น">
        {grades.map((g) => (
          <button key={g.id} aria-pressed={grade === g.id} onClick={() => setGrade(g.id)}>{g.shortTh}</button>
        ))}
      </div>
      <p className="sub" data-testid="grade-summary">
        {shown.length} ตัวชี้วัด · พร้อมใช้ {sum.ready} / {sum.target} ข้อ · ช่องที่ยังไม่ครบ {sum.shortCells}
      </p>
      <div className="table-wrap">
        <table className="coverage" data-testid="coverage-table">
          <thead>
            <tr>
              <th>ตัวชี้วัด</th>
              {levels.map((l) => <th key={l.id} style={{ textAlign: 'center' }}>{l.nameTh}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((ind) => (
              <tr key={ind.id}>
                <td>
                  <div className="ind-code">{ind.code}</div>
                  <div className="ind-text">{ind.text}</div>
                  {ind.assessmentNote && <div className="ind-note">⚠ {ind.assessmentNote}</div>}
                </td>
                {levels.map((l) => {
                  const c = byKey.get(`${ind.id}|${l.id}`);
                  const ready = c?.ready ?? 0;
                  return <td key={l.id} className={`cell ${cellState(ready, target)}`}>{ready}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--ok-bg)' }} />ครบเป้า</span>
        <span><i style={{ background: 'var(--low-bg)' }} />ยังไม่ครบ</span>
        <span><i style={{ background: 'var(--none-bg)' }} />ยังไม่มีข้อ</span>
      </div>
    </>
  );
}
