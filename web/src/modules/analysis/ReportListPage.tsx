// เมนู "รายงานผล": ชุดที่เริ่มตรวจแล้ว (ดูรายงาน/ส่งออก/ปิดชุด) และชุดที่ปิดแล้ว (ค่ารวมที่เก็บไว้)
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import { EXAM_STATUS_TH, type ExamSummary } from '../../core/types';
import { href } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { ExpiryNotice, daysLeft, thDate, warnDays } from './expiry';

export function ReportListPage() {
  const { data: ref } = useRefData();
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { repo.listExams('MATH').then(setExams, (e) => setError((e as Error).message)); }, []);
  const gradeShort = (id: string) => ref?.grades.find((g) => g.id === id)?.shortTh ?? id;
  const open = exams?.filter((e) => e.status === 'open') ?? [];
  const closed = exams?.filter((e) => e.status === 'closed' || e.status === 'expired') ?? [];
  const w = warnDays(ref?.settings);

  const row = (e: ExamSummary) => {
    const d = daysLeft(e.expiresAt);
    return (
      <li key={e.id}>
        <a className="item-row" href={href(`/exams/${e.id}/report`)}>
          <div className="item-top">
            <strong>{e.title}</strong>
            <span className={`chip ex-${e.status}`}>{EXAM_STATUS_TH[e.status]}</span>
            {d !== null && e.status === 'open' && <span className={`chip${d <= w ? ' weak' : ''}`}>ลบข้อมูลรายเลขที่ใน {d} วัน</span>}
          </div>
          <div className="item-flags">
            <span>{gradeShort(e.gradeId)}</span><span>{e.itemCount} ข้อ</span><span>นักเรียน {e.studentCount} คน</span>
            {e.closedAt && <span>{e.status === 'expired' ? 'หมดอายุ' : 'ปิด'} {thDate(e.closedAt)}</span>}
          </div>
        </a>
      </li>
    );
  };

  return (
    <>
      <h1>รายงานผล</h1>
      <p className="sub">คะแนนรายเลขที่ รายตัวชี้วัด วิเคราะห์รายข้อ (p, r, ตัวลวง) ส่งออก Excel/PDF และปิดชุดข้อสอบ</p>
      {exams && <ExpiryNotice exams={exams} settings={ref?.settings} />}
      {error && <div className="error" role="alert">{error}</div>}
      {!exams && !error && <p className="sub">กำลังโหลด…</p>}
      {exams && (
        <>
          <h2>กำลังสอบ (มีผลตรวจ)</h2>
          {open.length === 0 ? <div className="card empty">ยังไม่มีชุดที่เริ่มตรวจ · <a href="#/scan">ไปตรวจกระดาษคำตอบ</a></div>
            : <ul className="item-list" data-testid="report-open-list">{open.map(row)}</ul>}
          {closed.length > 0 && (
            <>
              <h2>ปิดแล้ว / หมดอายุ</h2>
              <p className="sub">ข้อมูลรายเลขที่ถูกลบแล้ว เหลือสถิติรายข้อในคลังและค่ารวมของห้อง</p>
              <ul className="item-list" data-testid="report-closed-list">{closed.map(row)}</ul>
            </>
          )}
        </>
      )}
    </>
  );
}
