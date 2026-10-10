// ปิดชุดข้อสอบ (SPEC §10): หน้ายืนยัน → ดาวน์โหลดรายงานฉบับสุดท้าย → รวมสถิติรายข้อเข้าคลัง → ลบข้อมูลรายเลขที่ทั้งหมด
import { useMemo, useState } from 'react';
import { repo } from '../../data';
import type { ClosedSummary } from '../../core/types';
import { href } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { analysisConfigFromSettings, analyze } from './analyze';
import { buildReportXlsx, compactSeats, fix, makeNames, reportFileName } from './report';
import { download, useExamWithScans } from './ReportPage';
import { expiryText } from './expiry';
import './report.css';

export function ClosePage({ id }: { id: string }) {
  const { data: ref } = useRefData();
  const { exam, scans, error } = useExamWithScans(id);
  const [downloaded, setDownloaded] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<ClosedSummary | null>(null);
  const cfg = useMemo(() => analysisConfigFromSettings(ref?.settings ?? {}), [ref]);
  const names = useMemo(() => (ref ? makeNames(ref.indicators, ref.difficulties, ref.grades) : null), [ref]);
  const a = useMemo(() => (exam && exam.status === 'open' ? analyze(exam, scans, cfg) : null), [exam, scans, cfg]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (exam === undefined || !names) return <p className="sub">กำลังโหลด…</p>;
  if (exam === null) return <div className="card">ไม่พบชุดข้อสอบนี้</div>;

  const crumb = <div className="crumb"><a href="#/exams">ชุดข้อสอบ</a> › <a href={href(`/exams/${exam.id}`)}>{exam.title}</a> › ปิดชุด</div>;

  if (done) {
    return (
      <>
        {crumb}
        <h1>ปิดชุดข้อสอบแล้ว</h1>
        <div className="card" role="status" data-testid="close-done">
          <ul className="close-facts">
            <li>บันทึกสถิติรายข้อ (p, r, สัดส่วนการเลือกตัวลวง) เข้าคลัง <b>{done.itemsRecorded}</b> ข้อ จากนักเรียน {done.n} คน</li>
            <li>ลบคะแนนและคำตอบรายเลขที่ออกจากระบบแล้ว <b>{done.responsesDeleted}</b> เลขที่</li>
            <li>คะแนนเฉลี่ยของห้อง {fix(done.mean)} / {done.itemCount} (เก็บไว้เฉพาะค่ารวมของห้อง)</li>
          </ul>
          <div className="actions wrap">
            <a className="btn" href={href(`/exams/${exam.id}/report`)}>ดูสรุปที่เก็บไว้</a>
            <a className="btn ghost" href="#/exams">กลับไปรายการชุดข้อสอบ</a>
          </div>
        </div>
      </>
    );
  }

  if (exam.status !== 'open' || !a) {
    return (
      <>
        {crumb}
        <div className="card">
          {exam.status === 'draft' ? 'ชุดข้อสอบนี้ยังไม่ได้เริ่มตรวจ — ถ้าไม่ใช้แล้วให้ลบชุดในหน้ารายละเอียดชุด' : 'ชุดข้อสอบนี้ปิดแล้ว'} ·{' '}
          <a href={href(`/exams/${exam.id}`)}>กลับ</a>
        </div>
      </>
    );
  }

  async function getReport() {
    setBusy(true);
    setErr(null);
    try { download(await buildReportXlsx(exam!, a!, names!), reportFileName(exam!, names!)); setDownloaded(true); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function close() {
    setBusy(true);
    setErr(null);
    try { setDone(await repo.closeExam(exam!.id)); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const s = a.summary;
  return (
    <>
      {crumb}
      <h1>ปิดชุดข้อสอบ: {exam.title}</h1>
      <p className="sub">ปิดแล้วย้อนกลับไม่ได้ — ระบบจะเก็บไว้เฉพาะสถิติรายข้อ (เข้าคลัง) และค่ารวมของห้อง</p>

      <div className="card report-section" data-testid="close-facts">
        <h2>สถานะก่อนปิด</h2>
        <ul className="close-facts">
          <li>ตรวจแล้ว <b>{s.n}</b> จาก {s.studentCount} คน{s.missingSeats.length > 0 && <> · <span className="ok-text" style={{ color: 'var(--warn)' }}>ยังไม่ตรวจ/ขาดสอบ เลขที่ {compactSeats(s.missingSeats)}</span></>}</li>
          {s.unresolvedSeats.length > 0 && <li style={{ color: 'var(--warn)' }}>มี remark ยังไม่ยืนยัน เลขที่ {compactSeats(s.unresolvedSeats)} · <a href={href(`/exams/${exam.id}/scan`, { tab: 'results' })}>ไปตรวจทานก่อน</a></li>}
          <li>จะบันทึกสถิติเข้าคลัง {a.items.filter((i) => i.n > 0).length} ข้อ · คะแนนเฉลี่ย {fix(s.mean)} / {s.itemCount}</li>
          {exam.expiresAt && <li>{expiryText(exam.expiresAt)} (ถ้าไม่ปิดเอง)</li>}
        </ul>
      </div>

      <div className="close-steps">
        <div className="card step">
          <span className="step-no">1</span>
          <div>
            <h2 style={{ margin: '0 0 6px' }}>เก็บรายงานฉบับสุดท้าย</h2>
            <p className="sub" style={{ margin: '0 0 8px' }}>คะแนนรายเลขที่ รายตัวชี้วัด และวิเคราะห์รายข้อ — ใช้ลงสมุดคะแนน (หลังปิดชุดจะดาวน์โหลดอีกไม่ได้)</p>
            <div className="actions wrap" style={{ marginTop: 0 }}>
              <button className="btn" disabled={busy || s.n === 0} onClick={getReport} data-testid="close-download">ดาวน์โหลดรายงาน Excel</button>
              <a className="btn ghost" href={href(`/exams/${exam.id}/report`)}>เปิดรายงานเพื่อพิมพ์ / บันทึก PDF</a>
            </div>
            {downloaded && <p className="ok-text" role="status" data-testid="close-downloaded">ดาวน์โหลดแล้ว ✓</p>}
          </div>
        </div>
        <div className="card step">
          <span className="step-no">2</span>
          <div>
            <h2 style={{ margin: '0 0 6px' }}>ยืนยันการปิดชุด</h2>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="close-agree" />
              เก็บรายงานฉบับสุดท้ายแล้ว และเข้าใจว่าคะแนน/คำตอบรายเลขที่ทั้งหมดจะถูกลบถาวร
            </label>
            {err && <div className="error" role="alert">{err}</div>}
            <div className="actions">
              <button className="btn danger" disabled={!agree || busy} onClick={close} data-testid="close-confirm">ปิดชุดและลบข้อมูลรายเลขที่</button>
              <a className="btn ghost" href={href(`/exams/${exam.id}/report`)}>ยกเลิก</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
