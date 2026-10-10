// หน้าสรุปสุขภาพคลัง (เฟส 7, SPEC §11): ข้อต้องแก้, ช่องที่ต้องเติมข้อ (แจ้งเตือนเมื่อข้อย้ายออกจนต่ำกว่าเป้า),
// การย้ายระดับล่าสุด, ความครบของสถิติ, บันทึกการปรับ · ปกติระบบปรับเองทุกครั้งที่ปิดชุด มีปุ่มสั่งปรับทั้งคลังเมื่อเปลี่ยนเกณฑ์
import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { STATUS_TH, type ItemStatus } from '../../core/types';
import { href } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { DIRECTION_TH, FLAG_TH, type BankHealth, type CalibrationRun } from './calibrate';
import './calibration.css';

const fmtDate = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
const fmtTime = (s: string) => new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const f2 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2));

export function FlagChip({ flag }: { flag: 'low_r' | 'negative_r' | null }) {
  if (!flag) return null;
  return <span className={`chip flag-${flag}`} data-testid="flag-chip">{FLAG_TH[flag]}</span>;
}

export function RunResult({ run, levelName }: { run: CalibrationRun; levelName: (id: number) => string }) {
  const nothing = !run.moved.length && !run.flagged.length && !run.unflagged.length;
  return (
    <div className="calib-result" data-testid="calib-result">
      {nothing && <p style={{ margin: 0 }}>ตรวจ {run.itemsChecked} ข้อ — ไม่มีข้อที่ต้องย้ายระดับหรือติดป้าย</p>}
      {run.moved.length > 0 && (
        <div>
          <strong>ย้ายระดับ {run.moved.length} ข้อ</strong>
          <ul className="plain compact">
            {run.moved.map((m) => (
              <li key={m.itemId}>
                <a href={href(`/items/${m.itemId}`)}>{m.itemCode}</a> {levelName(m.from)} → <b>{levelName(m.to)}</b>
                <span className="sub inline"> ({DIRECTION_TH[m.direction]} · p {m.p.toFixed(2)} · n {m.n})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {run.flagged.length > 0 && (
        <div>
          <strong>ติดป้ายต้องแก้ {run.flagged.length} ข้อ</strong>
          <ul className="plain compact">
            {run.flagged.map((f) => (
              <li key={f.itemId}><a href={href(`/items/${f.itemId}`)}>{f.itemCode}</a> <FlagChip flag={f.flag} /> <span className="sub inline">r {f2(f.r)}</span></li>
            ))}
          </ul>
          {run.stopped > 0 && <p className="warn-text" style={{ margin: '4px 0 0' }}>หยุดสุ่มเข้าชุด {run.stopped} ข้อ (r ติดลบ) จนกว่าจะแก้</p>}
        </div>
      )}
      {run.unflagged.length > 0 && <p style={{ margin: 0 }}>ป้ายต้องแก้หายไป {run.unflagged.length} ข้อ (ค่า r ดีขึ้น)</p>}
      {run.shortfalls.length > 0 && (
        <div className="calib-alert" role="alert" data-testid="calib-shortfalls">
          <strong>ช่องที่ต่ำกว่าเป้าเพราะมีข้อย้ายออก {run.shortfalls.length} ช่อง — ต้องเติมข้อ</strong>
          <ul className="plain compact">
            {run.shortfalls.map((s) => (
              <li key={`${s.indicatorId}|${s.difficultyId}`}>
                {s.indicatorCode} · {levelName(s.difficultyId)}: พร้อมใช้ {s.ready}/{s.target}{' '}
                <a href={href('/items/new', { ind: s.indicatorId, d: s.difficultyId })}>+ เพิ่มข้อ</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function HealthPage() {
  const { data: ref } = useRefData();
  const [h, setH] = useState<BankHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<CalibrationRun | null>(null);
  const [grade, setGrade] = useState<string>('');
  const [onlyMoved, setOnlyMoved] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    try { setH(await repo.getBankHealth('MATH')); } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { load(); }, []);

  const levelName = (id: number) => ref?.difficulties.find((d) => d.id === id)?.nameTh ?? String(id);
  const gradeName = (id: string) => ref?.grades.find((g) => g.id === id)?.shortTh ?? id;

  const movedCells = useMemo(() => h?.shortfalls.filter((s) => (s.movedOut ?? 0) > 0) ?? [], [h]);
  const moved = onlyMoved ?? movedCells.length > 0;
  const shortList = useMemo(() => (h?.shortfalls ?? [])
    .filter((s) => (!moved || (s.movedOut ?? 0) > 0) && (!grade || s.gradeId === grade)), [h, moved, grade]);

  async function calibrateAll() {
    setBusy(true); setError(null); setRun(null);
    try { setRun(await repo.runCalibration()); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (error && !h) return <div className="error" role="alert">{error}</div>;
  if (!h || !ref) return <p className="sub">กำลังโหลด…</p>;

  const s = h.settings;
  const urgent = h.flagged.filter((f) => f.flag === 'negative_r');
  const low = h.flagged.filter((f) => f.flag === 'low_r');
  const live = h.nBuckets.none + h.nBuckets.collecting + h.nBuckets.calibrated;
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const flaggedShown = showAll ? h.flagged : h.flagged.slice(0, 20);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สุขภาพคลังข้อสอบ</h1>
          <p className="sub" data-testid="calib-rules">
            ระบบปรับระดับความยากเองทุกครั้งที่ปิดชุดข้อสอบ: ย้ายเมื่อ n ≥ {s.minNToMove} คน · ช่วงกันชน ±{s.buffer.toFixed(2)} ·
            r &lt; {s.rFlagBelow.toFixed(2)} = ต้องแก้ · r ติดลบ = หยุดสุ่มเข้าชุด (ตัดสิน r เมื่อ n ≥ {s.rMinN})
            {s.sameGradeOnly ? ' · นับเฉพาะนักเรียนชั้นเดียวกับตัวชี้วัด' : ' · นับนักเรียนทุกชั้น'}
          </p>
        </div>
        <button className="btn ghost" onClick={calibrateAll} disabled={busy} data-testid="calib-run-all">
          {busy ? 'กำลังปรับ…' : 'ปรับความยากทั้งคลังตอนนี้'}
        </button>
      </div>
      {error && <div className="error box" role="alert">{error}</div>}
      {run && (
        <div className="card report-section" role="status">
          <h2>ผลการปรับทั้งคลัง</h2>
          <RunResult run={run} levelName={levelName} />
        </div>
      )}

      {(urgent.length > 0 || movedCells.length > 0) && (
        <div className="card calib-alert" role="alert" data-testid="health-alerts">
          {urgent.length > 0 && (
            <p><b>ต้องแก้ด่วน {urgent.length} ข้อ</b> — ค่า r ติดลบ (เด็กเก่งตอบผิดมากกว่าเด็กอ่อน มักเพราะเฉลยผิดหรือโจทย์กำกวม) ระบบหยุดสุ่มเข้าชุดแล้ว ·{' '}
              <a href={href('/items', { flag: 'negative_r', sample: undefined })}>ดูรายการ</a></p>
          )}
          {movedCells.length > 0 && (
            <p><b>{movedCells.length} ช่องต่ำกว่าเป้าเพราะมีข้อย้ายออก</b> ในช่วง {s.recentDays} วัน — ดูรายการช่องที่ต้องเติมด้านล่าง</p>
          )}
        </div>
      )}

      <div className="cards" data-testid="health-stats">
        <div className="card"><div className="stat-label">ข้อพร้อมใช้ / เป้าคลัง</div>
          <div className="stat-value">{h.coverage.readyTotal.toLocaleString('th-TH')}<small> / {h.coverage.targetTotal.toLocaleString('th-TH')}</small></div></div>
        <div className="card"><div className="stat-label">ช่องครบเป้า ({s.target} ข้อ)</div>
          <div className="stat-value" data-testid="stat-full">{h.coverage.full}<small> / {h.coverage.cells}</small></div></div>
        <div className="card"><div className="stat-label">สถิติครบเกณฑ์ (n ≥ {s.minNToMove})</div>
          <div className="stat-value" data-testid="stat-calibrated">{h.nBuckets.calibrated}<small> / {live} ข้อ</small></div></div>
        <div className="card"><div className="stat-label">ต้องแก้</div>
          <div className="stat-value" data-testid="stat-flagged">{h.flagged.length}<small> ข้อ{h.needsFixCount ? ` · สถานะต้องแก้ ${h.needsFixCount}` : ''}</small></div></div>
      </div>

      <section className="card report-section" data-testid="health-flagged">
        <h2>ข้อที่ต้องแก้ (ค่าอำนาจจำแนก r)</h2>
        {h.flagged.length === 0 ? <p className="sub" style={{ margin: 0 }}>ยังไม่มีข้อที่ค่า r ต่ำ (ตัดสินเมื่อมีนักเรียนทำข้อนั้นครบ {s.rMinN} คน)</p> : (
          <>
            <p className="sub" style={{ margin: '0 0 8px' }}>
              ติดลบ {urgent.length} ข้อ (หยุดสุ่ม) · ต่ำกว่า {s.rFlagBelow.toFixed(2)} {low.length} ข้อ (ยังสุ่มเข้าชุดได้ ควรปรับตัวลวง/ถ้อยคำ) — แก้เนื้อหาแล้วขึ้นเวอร์ชันใหม่ สถิติจะเริ่มนับใหม่
            </p>
            <div className="table-wrap">
              <table className="report-table">
                <thead><tr><th>รหัสข้อ</th><th className="left">ตัวชี้วัด</th><th>ระดับ</th><th>r</th><th>n</th><th>p</th><th>สถานะ</th><th>ป้าย</th></tr></thead>
                <tbody>
                  {flaggedShown.map((f) => (
                    <tr key={f.itemId}>
                      <td><a href={href(`/items/${f.itemId}`)}>{f.itemCode}</a></td>
                      <td className="left">{f.indicatorCode}</td>
                      <td>{levelName(f.difficulty)}</td>
                      <td className={f.flag === 'negative_r' ? 'fail' : ''}>{f2(f.r)}</td>
                      <td>{f.nR ?? '—'}</td>
                      <td>{f2(f.p)}</td>
                      <td>{STATUS_TH[f.status as ItemStatus] ?? f.status}</td>
                      <td><FlagChip flag={f.flag} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {h.flagged.length > 20 && !showAll && <button className="btn ghost" onClick={() => setShowAll(true)}>แสดงทั้งหมด {h.flagged.length} ข้อ</button>}
          </>
        )}
      </section>

      <section className="card report-section" data-testid="health-shortfalls">
        <h2>ช่องที่ต้องเติมข้อ <small className="sub">({h.shortfalls.length} จาก {h.coverage.cells} ช่องยังต่ำกว่าเป้า {s.target} ข้อ)</small></h2>
        <div className="filters" style={{ marginBottom: 8 }}>
          <div className="tabs" role="group" aria-label="เลือกชั้น" style={{ margin: 0 }}>
            <button aria-pressed={!grade} onClick={() => setGrade('')}>ทุกชั้น</button>
            {ref.grades.map((g) => <button key={g.id} aria-pressed={grade === g.id} onClick={() => setGrade(g.id)}>{g.shortTh}</button>)}
          </div>
          <label className="check">
            <input type="checkbox" checked={moved} onChange={(e) => setOnlyMoved(e.target.checked)} data-testid="only-moved" />
            เฉพาะช่องที่มีข้อย้ายออก ({movedCells.length})
          </label>
        </div>
        {shortList.length === 0 ? <p className="sub" style={{ margin: 0 }}>{moved ? 'ไม่มีช่องที่ขาดเพราะข้อย้ายออก' : 'ทุกช่องครบเป้าแล้ว'}</p> : (
          <div className="table-wrap">
            <table className="report-table" data-testid="shortfall-table">
              <thead><tr><th className="left">ตัวชี้วัด</th><th>ระดับ</th><th>พร้อมใช้</th><th>ต้องเติม</th><th>ร่าง/ต้องแก้</th><th>ย้ายออก ({s.recentDays} วัน)</th><th></th></tr></thead>
              <tbody>
                {shortList.slice(0, 200).map((c) => (
                  <tr key={`${c.indicatorId}|${c.difficultyId}`} className={(c.movedOut ?? 0) > 0 ? 'moved-out' : ''}>
                    <td className="left">{gradeName(c.gradeId)} {c.indicatorCode}</td>
                    <td>{levelName(c.difficultyId)}</td>
                    <td>{c.ready}/{c.target}</td>
                    <td><b>{c.target - c.ready}</b></td>
                    <td>{(c.draft ?? 0) + (c.needsFix ?? 0) || '—'}</td>
                    <td>{c.movedOut ? <span className="warn-text">{c.movedOut}</span> : '—'}</td>
                    <td><a href={href('/items/new', { ind: c.indicatorId, d: c.difficultyId })}>+ เพิ่มข้อ</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card report-section" data-testid="health-moves">
        <h2>การย้ายระดับ {s.recentDays} วันล่าสุด <small className="sub">(ทั้งหมด {h.moveTotals.allTime} ครั้ง: ง่ายขึ้น {h.moveTotals.easier} · ยากขึ้น {h.moveTotals.harder})</small></h2>
        {h.recentMoves.length === 0 ? <p className="sub" style={{ margin: 0 }}>ยังไม่มีการย้ายระดับในช่วงนี้</p> : (
          <div className="table-wrap">
            <table className="report-table">
              <thead><tr><th>รหัสข้อ</th><th className="left">ตัวชี้วัด</th><th>จาก</th><th>ไป</th><th>p</th><th>n</th><th>วันที่</th></tr></thead>
              <tbody>
                {h.recentMoves.map((m, k) => (
                  <tr key={`${m.itemId}-${k}`}>
                    <td><a href={href(`/items/${m.itemId}`)}>{m.itemCode}</a></td>
                    <td className="left">{gradeName(m.gradeId)} {m.indicatorCode}</td>
                    <td>{levelName(m.from)}</td>
                    <td><b>{levelName(m.to)}</b> <span className={m.direction === 'easier' ? 'ok-text' : 'warn-text'}>{m.direction === 'easier' ? '↑' : '↓'}</span></td>
                    <td>{m.p.toFixed(2)}</td>
                    <td>{m.n}</td>
                    <td>{m.movedAt ? fmtDate(m.movedAt) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="health-grid">
        <section className="card report-section" data-testid="health-nbuckets">
          <h2>ความครบของสถิติ</h2>
          <ul className="bars">
            {[
              ['ยังไม่มีสถิติ', h.nBuckets.none],
              [`กำลังเก็บ (1–${s.minNToMove - 1})`, h.nBuckets.collecting],
              [`ครบเกณฑ์ (≥ ${s.minNToMove})`, h.nBuckets.calibrated],
            ].map(([label, v]) => (
              <li key={label as string} className="wide-label"><span>{label}</span>
                <span className="bar"><span style={{ width: `${pct(v as number, live)}%` }} /></span><span className="num">{v as number}</span></li>
            ))}
          </ul>
          <p className="sub" style={{ margin: '8px 0 0' }}>นับเฉพาะข้อตรวจแล้ว/ใช้งาน/ต้องแก้{h.sampleCount ? ` · มีข้อหุ่น ${h.sampleCount} ข้อ` : ''}</p>
        </section>
        <section className="card report-section" data-testid="health-levelmix">
          <h2>ระดับคาดการณ์ เทียบ ระดับปัจจุบัน</h2>
          <table className="report-table">
            <thead><tr><th className="left">ระดับ</th><th>ครูคาด</th><th>ตามสถิติ</th></tr></thead>
            <tbody>
              {h.levelMix.map((l) => (
                <tr key={l.difficulty}><td className="left">{levelName(l.difficulty)}</td><td>{l.est}</td><td><b>{l.current}</b></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card report-section" data-testid="health-runs">
        <h2>บันทึกการปรับความยากล่าสุด</h2>
        {h.runs.length === 0 ? <p className="sub" style={{ margin: 0 }}>ยังไม่เคยปรับ — ระบบจะปรับเองเมื่อปิดชุดข้อสอบครั้งแรก</p> : (
          <ul className="plain compact">
            {h.runs.map((r) => (
              <li key={r.id}>
                <span className="sub inline">{fmtTime(r.ranAt)}</span>{' '}
                {r.source === 'exam' ? (r.examId && !r.examId.startsWith('demo-') ? <a href={href(`/exams/${r.examId}/report`)}>ปิดชุดข้อสอบ</a> : 'ปิดชุดข้อสอบ') : 'สั่งปรับเอง'}
                {' — '}ตรวจ {r.itemsChecked} ข้อ · ย้าย {r.moved} · ติดป้าย {r.flagged}{r.unflagged ? ` · ป้ายหาย ${r.unflagged}` : ''}
                {r.shortfalls ? <span className="warn-text"> · ช่องขาด {r.shortfalls}</span> : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
