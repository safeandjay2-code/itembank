// ส่งออกชีทและปิดเทอม (One Stop เฟส 5 · SPEC-OneStop.md หัวข้อ 6–7)
//   1) ส่งออกชีทคะแนนตามหัวข้อ 6.1 — วางรายชื่อได้ ชื่อรวมลงไฟล์ในเบราว์เซอร์นี้เท่านั้น ไม่ส่งขึ้นเซิร์ฟเวอร์ และไม่จำไว้
//   2) ปิดเทอม — เตือนเรื่องที่ยังค้าง → ยืนยันด้วยการพิมพ์ชื่อห้อง → repo.closeClassroom (ย้อนกลับไม่ได้)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import type { ClassroomCloseSummary, ClassroomDetail, GbSheet } from '../../core/types';
import { useRefData } from '../core/useRefData';
import { download } from '../analysis/ReportPage';
import { fmtScore } from './plan';
import { uncollectedColumns } from './sheet';
import { buildGradebookXlsx, exportColumns, exportFileName, parseNames } from './exportSheet';
import '../analysis/report.css';
import './book.css';

export function TermClosePage({ id }: { id: string }) {
  const { data: ref } = useRefData();
  const [room, setRoom] = useState<ClassroomDetail | null | undefined>(undefined);
  const [sheet, setSheet] = useState<GbSheet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [namesText, setNamesText] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [agree, setAgree] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ClassroomCloseSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await repo.getClassroom(id);
      setRoom(r);
      if (r && r.status === 'open') setSheet(await repo.getGradebook(id));
    } catch (e) { setErr((e as Error).message); setRoom((x) => (x === undefined ? null : x)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const parsed = useMemo(() => parseNames(namesText, sheet?.seatCount ?? room?.studentCount ?? 0), [namesText, sheet, room]);
  const indCode = (indId: string | null) => (indId ? ref?.indicatorById.get(indId)?.code ?? indId : '');

  if (room === undefined) return err ? <div className="error box" role="alert">{err}</div> : <p className="sub">กำลังโหลด…</p>;
  if (room === null) return <div className="card">ไม่พบห้องเรียน · <a href="#/classes">กลับไปรายการห้อง</a></div>;

  const crumb = (
    <p className="crumb"><a href="#/classes">← ห้องเรียน</a> · <a href={`#/classes/${room.id}`}>ตั้งค่าห้อง {room.name}</a>
      {' · '}<a href={`#/classes/${room.id}/book`}>สมุดคะแนน</a></p>
  );
  const summary = done ?? room.closedSummary;

  if (room.status !== 'open' || done) {
    return (
      <>
        {crumb}
        <h1 data-testid="term-title">ปิดเทอมแล้ว: {room.name} <small className="sub">ภาคเรียนที่ {room.term}/{room.academicYear}</small></h1>
        {summary ? (
          <div className="card" role="status" data-testid="term-done">
            <ul className="close-facts">
              <li>ลบคะแนนรายเลขที่ออกจากระบบแล้ว <b>{summary.attemptsDeleted}</b> รายการ · คะแนนที่ปรับ <b>{summary.overridesDeleted}</b> รายการ</li>
              {summary.examsClosed > 0 && <li>ปิดชุดข้อสอบที่ยังเปิดอยู่พร้อมกัน <b>{summary.examsClosed}</b> ชุด (สถิติรายข้อเข้าคลังแล้ว)</li>}
              <li>เหลือเฉพาะค่ารวมของห้อง: คะแนนรวมเฉลี่ย <b data-testid="term-total-mean">{summary.totalMean === null ? '–' : fmtScore(summary.totalMean)}</b> (นักเรียน {summary.seatCount} คน)</li>
            </ul>
            <div className="book-wrap" style={{ marginTop: 8 }}>
              <table className="book" data-testid="term-summary-table">
                <thead><tr><th>ช่อง</th><th>เต็ม</th><th>เฉลี่ย</th><th>ต่ำสุด</th><th>สูงสุด</th></tr></thead>
                <tbody>
                  {summary.columns.filter((c) => c.kind !== 'other' || c.collected).map((c, k) => (
                    <tr key={k}>
                      <th scope="row">{c.kind === 'final' ? 'สอบปลายภาค' : c.kind === 'other' ? c.label : indCode(c.indicatorId)}</th>
                      <td>{c.maxScore === null ? '–' : fmtScore(c.maxScore)}</td>
                      <td>{c.mean === null ? '–' : fmtScore(c.mean)}</td>
                      <td>{c.min === null ? '–' : fmtScore(c.min)}</td>
                      <td>{c.max === null ? '–' : fmtScore(c.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions wrap">
              <a className="btn" href="#/classes">กลับไปรายการห้อง</a>
              <a className="btn ghost" href="#/classes/new">สร้างห้องเทอมใหม่</a>
            </div>
          </div>
        ) : <div className="card">ห้องนี้ปิดเทอมแล้ว</div>}
      </>
    );
  }

  if (!sheet) return err ? <div className="error box" role="alert">{err}</div> : <p className="sub">กำลังโหลด…</p>;

  const { plan, final } = exportColumns(sheet);
  const uncollected = uncollectedColumns(sheet);
  const absentCells = sheet.rows.reduce((n, r) => n + r.cells.filter((x) => x.missing.length > 0).length, 0);
  const openExams = sheet.exams.filter((e) => e.purpose !== 'practice' && (e.status === 'open' || e.status === 'draft'));
  const nameOk = typed.trim() === room.name.trim();
  const colName = (c: GbSheet['columns'][number]) => (c.kind === 'final' ? 'สอบปลายภาค' : c.kind === 'other' ? c.label ?? 'ช่องอื่น' : c.code ?? '');

  async function getSheet() {
    setBusy(true); setErr(null);
    try { download(await buildGradebookXlsx(sheet!, parsed.names), exportFileName(sheet!)); setDownloaded(true); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function closeTerm() {
    setBusy(true); setErr(null);
    try { setDone(await repo.closeClassroom(room!.id)); setNamesText(''); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      {crumb}
      <h1 data-testid="term-title">ส่งออกชีทและปิดเทอม: {room.name} <small className="sub">ภาคเรียนที่ {room.term}/{room.academicYear}</small></h1>
      <p className="sub">ส่งออกชีทได้กี่ครั้งก็ได้ตลอดเทอม · ปิดเทอมเมื่อได้ชีทฉบับสุดท้ายแล้วเท่านั้น (ย้อนกลับไม่ได้)</p>
      {err && <div className="error box" role="alert">{err}</div>}

      <div className="close-steps">
        <div className="card step">
          <span className="step-no">1</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: '0 0 6px' }}>ส่งออกชีทคะแนน (Excel)</h2>
            <p className="sub" style={{ margin: '0 0 8px' }}>
              แถว = เลขที่ · คอลัมน์ = ตัวชี้วัด {plan.length} ช่อง (เรียงตามแผนการสอน) → รวม → สอบ → รวม · คอลัมน์รวมเป็นสูตร แก้คะแนนในชีทแล้วยอดรวมเปลี่ยนตาม
              {' · '}<a href={`#/classes/${room.id}`}>สลับลำดับคอลัมน์</a>
            </p>
            <label className="field" style={{ display: 'block' }}>
              <span>รายชื่อนักเรียน (ไม่บังคับ) — วางจาก Excel/SGS บรรทัดละคน ขึ้นต้นด้วยเลขที่ได้</span>
              <textarea rows={5} value={namesText} onChange={(e) => setNamesText(e.target.value)} data-testid="term-names"
                placeholder={'1 ด.ช.สมชาย ใจดี\n2 ด.ญ.มะลิ รักเรียน\n…'} style={{ width: '100%' }} autoComplete="off" spellCheck={false} />
            </label>
            <p className="sub" style={{ margin: '4px 0' }} data-testid="term-names-info">
              🔒 รายชื่ออยู่ในเบราว์เซอร์นี้เท่านั้น ไม่ส่งขึ้นเซิร์ฟเวอร์ และไม่จำไว้ (ปิดหน้าแล้วหาย) ·{' '}
              {parsed.names.size ? `จับคู่ได้ ${parsed.names.size} จาก ${sheet.seatCount} คน` : 'ไม่วาง = คอลัมน์ชื่อว่าง'}
            </p>
            {parsed.warnings.length > 0 && (
              <ul className="sub" style={{ color: 'var(--warn)', margin: '4px 0' }} data-testid="term-names-warn">
                {parsed.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}
                {parsed.warnings.length > 5 && <li>…อีก {parsed.warnings.length - 5} รายการ</li>}
              </ul>
            )}

            <details style={{ margin: '8px 0' }}>
              <summary>ดูตัวอย่างชีท</summary>
              <div className="book-wrap">
                <table className="book" data-testid="term-preview">
                  <thead>
                    <tr><th rowSpan={3}>ที่</th><th rowSpan={3}>ชื่อ - สกุล</th>
                      {plan.map(({ col }) => <th key={col.id} rowSpan={col.kind === 'other' ? 2 : 1}>{col.kind === 'other' ? col.label : col.standardCode ?? col.code}</th>)}
                      <th rowSpan={2}>รวม</th><th rowSpan={2}>สอบ</th><th rowSpan={2}>รวม</th></tr>
                    <tr>{plan.filter(({ col }) => col.kind !== 'other').map(({ col }) => <th key={col.id}>{col.indicatorCode}</th>)}</tr>
                    <tr>{plan.map(({ col }) => <th key={col.id}>{col.maxScore === null ? '' : fmtScore(col.maxScore)}</th>)}
                      <th>{fmtScore(plan.reduce((a, { col }) => a + (col.maxScore ?? 0), 0))}</th>
                      <th>{final?.col.maxScore === null || !final ? '' : fmtScore(final.col.maxScore)}</th>
                      <th>{fmtScore(plan.reduce((a, { col }) => a + (col.maxScore ?? 0), 0) + (final?.col.maxScore ?? 0))}</th></tr>
                  </thead>
                  <tbody>
                    {sheet.rows.map((r) => {
                      const vals = plan.map(({ index }) => r.cells[index].value);
                      const sc = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
                      const fv = final ? r.cells[final.index].value : null;
                      return (
                        <tr key={r.seatNo}>
                          <th scope="row">{r.seatNo}</th>
                          <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{parsed.names.get(r.seatNo) ?? ''}</td>
                          {vals.map((v, k) => <td key={k}>{v === null ? '' : fmtScore(v)}</td>)}
                          <td className="sum">{fmtScore(Math.round(sc * 100) / 100)}</td>
                          <td>{fv === null ? '' : fmtScore(fv)}</td>
                          <td className="sum">{fmtScore(Math.round((sc + (fv ?? 0)) * 100) / 100)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="actions wrap" style={{ marginTop: 0 }}>
              <button className="btn" disabled={busy} onClick={getSheet} data-testid="term-download">ดาวน์โหลดชีท Excel</button>
              <a className="btn ghost" href={`#/classes/${room.id}/book`}>กลับไปสมุดคะแนน</a>
            </div>
            {downloaded && <p className="ok-text" role="status" data-testid="term-downloaded">ดาวน์โหลดแล้ว ✓ — แผ่นงาน "บันทึก" ในไฟล์เดียวกันมีรายการคะแนนที่ปรับและขาดสอบ</p>}
          </div>
        </div>

        <div className="card step">
          <span className="step-no">2</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: '0 0 6px' }}>ปิดเทอม</h2>
            <p className="sub" style={{ margin: '0 0 8px' }}>ระบบจะลบคะแนนรายเลขที่ คะแนนที่ปรับ และการเลือกสอบซ่อมทั้งหมดของห้องนี้ เก็บไว้เฉพาะค่าเฉลี่ยระดับห้อง · หลังปิดเทอมส่งออกชีทไม่ได้อีก</p>
            <ul className="close-facts" data-testid="term-checks">
              {uncollected.length > 0
                ? <li style={{ color: 'var(--warn)' }} data-testid="check-uncollected">ยังไม่เก็บคะแนน: {uncollected.map(colName).join(', ')}</li>
                : <li>เก็บคะแนนครบทุกช่องแล้ว ✓</li>}
              {sheet.totals.unsetColumns > 0 && <li style={{ color: 'var(--warn)' }} data-testid="check-unset">ยังไม่ตั้งคะแนนเต็ม {sheet.totals.unsetColumns} ช่อง</li>}
              {absentCells > 0 && <li style={{ color: 'var(--warn)' }} data-testid="check-absent">ขาดสอบ {absentCells} ช่อง ({sheet.classroom.settings.absent_policy === 'zero' ? 'นับเป็น 0' : 'ไม่นับครั้งที่ขาด'})</li>}
              {sheet.unplannedIndicators.length > 0 && <li style={{ color: 'var(--warn)' }}>มีคะแนนตัวชี้วัดที่ยังไม่มีช่อง {sheet.unplannedIndicators.length} ตัว (จะไม่อยู่ในชีท)</li>}
              {openExams.length > 0 && <li data-testid="check-open-exams">ชุดที่ยังเปิดอยู่ {openExams.length} ชุด — ชุดที่มีผลตรวจจะถูกปิดพร้อมกัน (สถิติเข้าคลัง) ชุดที่ยังไม่มีใครสอบจะกลับเป็นชุดฝึก</li>}
            </ul>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="term-agree" />
              {downloaded ? 'ได้ชีทฉบับสุดท้ายแล้ว' : 'ได้ชีทฉบับสุดท้ายแล้ว (ยังไม่ได้ดาวน์โหลดในหน้านี้ — ถ้ายังไม่มี ให้กดข้อ 1 ก่อน)'}
              {' '}และเข้าใจว่าคะแนนรายเลขที่ทั้งหมดจะถูกลบถาวร
            </label>
            <label className="field" style={{ display: 'block', marginTop: 8 }}>
              <span>พิมพ์ชื่อห้อง <b>{room.name}</b> เพื่อยืนยัน</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="term-confirm-name" autoComplete="off" />
            </label>
            <div className="actions">
              <button className="btn danger" disabled={!agree || !nameOk || busy} onClick={closeTerm} data-testid="term-close">ปิดเทอมและลบข้อมูลรายเลขที่</button>
              <a className="btn ghost" href={`#/classes/${room.id}/book`}>ยกเลิก</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
