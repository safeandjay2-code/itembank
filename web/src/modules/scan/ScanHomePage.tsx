// เมนู "ตรวจด้วยกล้อง": เลือกชุดข้อสอบที่จะตรวจ (เปิดบนมือถือได้ทันที)
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import { EXAM_STATUS_TH, type ExamSummary } from '../../core/types';
import { href } from '../../ui/router';
import { useRefData } from '../core/useRefData';

export function ScanHomePage() {
  const { data: ref } = useRefData();
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { repo.listExams('MATH').then(setExams, (e) => setError((e as Error).message)); }, []);
  const gradeShort = (id: string) => ref?.grades.find((g) => g.id === id)?.shortTh ?? id;
  const open = exams?.filter((e) => e.status === 'draft' || e.status === 'open') ?? [];
  return (
    <>
      <h1>ตรวจกระดาษคำตอบ</h1>
      <p className="sub">เลือกชุดข้อสอบ แล้วส่องกระดาษคำตอบด้วยกล้องมือถือ หรืออัปโหลดภาพ/PDF จากเครื่องสแกน</p>
      {error && <div className="error" role="alert">{error}</div>}
      {!exams && !error && <p className="sub">กำลังโหลด…</p>}
      {exams && open.length === 0 && <div className="card empty">ยังไม่มีชุดข้อสอบที่ตรวจได้ · <a href="#/exams/new">สร้างชุดข้อสอบ</a></div>}
      <ul className="item-list" data-testid="scan-exam-list">
        {open.map((e) => (
          <li key={e.id}>
            <a className="item-row" href={href(`/exams/${e.id}/scan`)}>
              <div className="item-top">
                <strong>{e.title}</strong>
                <span className={`chip ex-${e.status}`}>{EXAM_STATUS_TH[e.status]}</span>
              </div>
              <div className="item-flags">
                <span>{gradeShort(e.gradeId)}</span><span>{e.itemCount} ข้อ</span><span>{e.setCount} ชุด</span><span>นักเรียน {e.studentCount} คน</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
