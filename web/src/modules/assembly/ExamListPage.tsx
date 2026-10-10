// รายการชุดข้อสอบของผู้ใช้
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import { EXAM_STATUS_TH, type ExamSummary } from '../../core/types';
import { href } from '../../ui/router';
import { useRefData } from '../core/useRefData';

export function ExamListPage() {
  const { data: ref } = useRefData();
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { repo.listExams('MATH').then(setExams, (e) => setError((e as Error).message)); }, []);
  const gradeShort = (id: string) => ref?.grades.find((g) => g.id === id)?.shortTh ?? id;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ชุดข้อสอบ</h1>
          <p className="sub">ประกอบชุดข้อสอบจากคลัง สลับข้อและตัวเลือกหลายชุดกันลอก</p>
        </div>
        <a className="btn" href="#/exams/new">+ สร้างชุดข้อสอบ</a>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!exams && !error && <p className="sub">กำลังโหลด…</p>}
      {exams && exams.length === 0 && (
        <div className="card empty">ยังไม่มีชุดข้อสอบ · <a href="#/exams/new">สร้างชุดแรก</a></div>
      )}
      <ul className="item-list" data-testid="exam-list">
        {exams?.map((e) => (
          <li key={e.id}>
            <a className="item-row" href={href(`/exams/${e.id}`)}>
              <div className="item-top">
                <strong>{e.title}</strong>
                <span className={`chip ex-${e.status}`}>{EXAM_STATUS_TH[e.status]}</span>
              </div>
              <div className="item-flags">
                <span>{gradeShort(e.gradeId)}</span>
                <span>{e.itemCount} ข้อ</span>
                <span>{e.setCount} ชุด</span>
                <span>นักเรียน {e.studentCount} คน</span>
                <span>สร้าง {new Date(e.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
