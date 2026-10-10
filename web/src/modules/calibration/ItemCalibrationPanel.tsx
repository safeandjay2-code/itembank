// แผงปรับความยากรายข้อ (หน้าแก้ไขข้อ): สถิติที่ใช้ตัดสิน, ความคืบหน้าสู่เกณฑ์ n, ผลตัดสินล่าสุด, รอบสอบ, ประวัติการย้าย
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import type { DifficultyLevel, Grade, Settings } from '../../core/types';
import { calibrationConfigFromSettings, describeProgress, DIRECTION_TH, type ItemCalibrationInfo } from './calibrate';
import { FlagChip } from './HealthPage';
import './calibration.css';

const fmtDate = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2));

export function ItemCalibrationPanel({ itemId, version, settings, levels, grades, reloadKey }:
  { itemId: string; version: number; settings: Settings; levels: DifficultyLevel[]; grades: Grade[]; reloadKey?: unknown }) {
  const [info, setInfo] = useState<ItemCalibrationInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setInfo(undefined);
    repo.getItemCalibration(itemId).then(setInfo, (e) => setError((e as Error).message));
  }, [itemId, version, reloadKey]);

  const cfg = calibrationConfigFromSettings(settings);
  const levelName = (id: number) => levels.find((d) => d.id === id)?.nameTh ?? String(id);
  const gradeName = (id: string | null) => (id ? grades.find((g) => g.id === id)?.shortTh ?? id : '—');

  if (error) return <section className="card"><div className="error">{error}</div></section>;
  if (info === undefined) return <section className="card"><p className="sub">กำลังโหลดสถิติ…</p></section>;
  if (info === null) return null;

  const st = info.stats;
  const d = info.decision;
  const pct = Math.min(100, Math.round((100 * st.n) / Math.max(1, cfg.minNToMove)));
  const others = info.rounds.filter((r) => r.version === st.version && r.gradeId !== st.gradeId);

  return (
    <section className="card" data-testid="calib-panel">
      <h2>ปรับความยากตามสถิติจริง</h2>
      <p className="sub" style={{ margin: 0 }} data-testid="calib-progress">{describeProgress(cfg, st)}</p>
      <div className="progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div className="calib-stats" data-testid="calib-stats">
        <span>เวอร์ชัน <b>{st.version}</b></span>
        <span>นักเรียน {gradeName(st.gradeId)} n <b>{st.n}</b></span>
        <span>p <b>{f2(st.p)}</b></span>
        <span>r <b>{f2(st.r)}</b>{st.nR ? <small className="sub inline"> (จาก {st.nR} คน)</small> : null}</span>
        <span>{st.rounds} รอบสอบ</span>
      </div>
      {(d.target !== null || d.flag) && (
        <p className="warn-text" style={{ margin: '0 0 8px' }}>
          {d.target !== null && <>สถิติชี้ว่าควรเป็นระดับ {levelName(d.target)} ({d.direction ? DIRECTION_TH[d.direction] : ''}) — ระบบจะย้ายให้เมื่อปิดชุดข้อสอบครั้งถัดไปหรือสั่งปรับทั้งคลัง </>}
          {d.flag && <FlagChip flag={d.flag} />}
        </p>
      )}
      {others.length > 0 && cfg.sameGradeOnly && (
        <p className="sub" style={{ margin: '0 0 8px' }}>มีสถิติจากชั้นอื่น {others.reduce((a, r) => a + r.n, 0)} คน (เช่น ใช้ทบทวน) — ไม่นำมาปรับความยาก</p>
      )}

      <h3 style={{ margin: '10px 0 4px', fontSize: '1rem' }}>ประวัติการย้ายระดับ</h3>
      {info.moves.length === 0 ? <p className="sub" style={{ margin: 0 }} data-testid="calib-moves-empty">ยังไม่เคยย้ายระดับ</p> : (
        <ul className="plain compact" data-testid="calib-moves">
          {info.moves.slice().reverse().map((m, k) => (
            <li key={k}>{fmtDate(m.movedAt)} · v{m.version} · {levelName(m.from)} → <b>{levelName(m.to)}</b>
              <span className="sub inline"> ({DIRECTION_TH[m.direction]} · p {m.p.toFixed(2)} · n {m.n}{m.r !== null ? ` · r ${m.r.toFixed(2)}` : ''})</span></li>
          ))}
        </ul>
      )}

      {info.rounds.length > 0 && (
        <>
          <h3 style={{ margin: '12px 0 4px', fontSize: '1rem' }}>สถิติรายรอบสอบ</h3>
          <div className="table-wrap">
            <table className="report-table" data-testid="calib-rounds">
              <thead><tr><th>วันที่</th><th>เวอร์ชัน</th><th>ชั้น</th><th>n</th><th>p</th><th>r</th></tr></thead>
              <tbody>
                {info.rounds.slice().reverse().map((r, k) => (
                  <tr key={k} className={r.version !== st.version || (cfg.sameGradeOnly && r.gradeId !== st.gradeId) ? 'missing' : ''}>
                    <td>{fmtDate(r.recordedAt)}</td><td>v{r.version}</td><td>{gradeName(r.gradeId)}</td><td>{r.n}</td>
                    <td>{f2(r.n ? r.nCorrect / r.n : null)}</td><td>{f2(r.r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ margin: '4px 0 0' }}>แถวสีจาง = ไม่นับ (เวอร์ชันเก่าหรือชั้นอื่น)</p>
        </>
      )}
    </section>
  );
}
