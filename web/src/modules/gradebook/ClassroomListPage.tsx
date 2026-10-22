// รายการห้องเรียน/เทอมของครู (One Stop เฟส 2)
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import type { ClassroomSummary } from '../../core/types';
import { href } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import './book.css';

export function ClassroomListPage() {
  const { data: ref } = useRefData();
  const [rooms, setRooms] = useState<ClassroomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { repo.listClassrooms().then(setRooms, (e) => setError((e as Error).message)); }, []);
  const gradeShort = (id: string) => ref?.grades.find((g) => g.id === id)?.shortTh ?? id;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ห้องเรียน</h1>
          <p className="sub">ตั้งห้องต้นเทอม เลือกตัวชี้วัดและคะแนน ระบบเก็บคะแนนแยกตามตัวชี้วัดให้ตลอดเทอม (ใช้เลขที่ ไม่เก็บชื่อนักเรียน)</p>
        </div>
        <a className="btn" href="#/classes/new">+ สร้างห้องเรียน</a>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!rooms && !error && <p className="sub">กำลังโหลด…</p>}
      {rooms && rooms.length === 0 && (
        <div className="card empty">ยังไม่มีห้องเรียน · <a href="#/classes/new">สร้างห้องแรก</a></div>
      )}
      <ul className="item-list" data-testid="class-list">
        {rooms?.map((c) => (
          <li key={c.id}>
            <a className="item-row" href={href(`/classes/${c.id}`)}>
              <div className="item-top">
                <strong>{c.name}</strong>
                <span className={`chip ${c.status === 'open' ? 'ex-open' : 'ex-closed'}`}>{c.status === 'open' ? 'เปิดอยู่' : 'ปิดเทอมแล้ว'}</span>
              </div>
              <div className="item-flags">
                <span>{gradeShort(c.gradeId)}</span>
                <span>ภาคเรียนที่ {c.term}/{c.academicYear}</span>
                <span>นักเรียน {c.studentCount} คน</span>
                <span>ตัวชี้วัด {c.columnCount} ช่อง</span>
                <span>ชุดข้อสอบ {c.examCount} ชุด</span>
              </div>
            </a>
            <a className="row-link" href={href(`/classes/${c.id}/book`)} data-testid="class-book-link">สมุดคะแนน {c.name} →</a>
          </li>
        ))}
      </ul>
    </>
  );
}
