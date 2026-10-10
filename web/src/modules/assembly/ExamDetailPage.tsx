// รายละเอียดชุดข้อสอบ: คำเตือนตอนสร้าง, เฉลยและการกระจายเฉลยรายชุด, ลำดับข้อแต่ละชุด, เลขที่ → ชุด, ข้อในชุด
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import { EXAM_STATUS_TH, type ExamDetail } from '../../core/types';
import { navigate, type Route } from '../../ui/router';
import { useRefData } from '../core/useRefData';

const CIRCLE = ['①', '②', '③', '④'];

export function ExamDetailPage({ id, route, canOpenItems }: { id: string; route: Route; canOpenItems: boolean }) {
  const { data: ref } = useRefData();
  const [exam, setExam] = useState<ExamDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [setNo, setSetNo] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { repo.getExam(id).then(setExam, (e) => setError((e as Error).message)); }, [id]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (exam === undefined) return <p className="sub">กำลังโหลด…</p>;
  if (exam === null) return <div className="card">ไม่พบชุดข้อสอบนี้ · <a href="#/exams">กลับไปรายการชุดข้อสอบ</a></div>;

  const ind = (iid: string) => ref?.indicatorById.get(iid)?.code ?? iid;
  const diff = (d: number) => ref?.difficulties.find((x) => x.id === d)?.nameTh ?? d;
  const grade = ref?.grades.find((g) => g.id === exam.gradeId)?.shortTh ?? exam.gradeId;
  const itemById = new Map(exam.items.map((i) => [i.itemId, i]));
  const current = exam.sets.find((s) => s.setNo === setNo) ?? exam.sets[0];
  const counts = (entries: ExamDetail['sets'][number]['entries']) => [1, 2, 3, 4].map((k) => entries.filter((e) => e.key === k).length);
  const anchors = exam.items.filter((i) => i.isAnchor).length;
  const noShuffle = exam.items.filter((i) => i.noShuffle).length;
  const warnings = exam.build?.warnings ?? [];
  const infos = exam.build?.infos ?? [];

  async function remove() {
    setBusy(true);
    try { await repo.deleteExam(exam!.id); navigate('/exams', undefined, true); } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <>
      <div className="crumb"><a href="#/exams">ชุดข้อสอบ</a> › {exam.title}</div>
      <div className="page-head">
        <div>
          <h1>{exam.title}</h1>
          <p className="sub" data-testid="exam-meta">
            {grade} · {exam.itemCount} ข้อ · {exam.setCount} ชุด · นักเรียน {exam.studentCount} คน · <span className={`chip ex-${exam.status}`}>{EXAM_STATUS_TH[exam.status]}</span>
          </p>
        </div>
      </div>
      {route.params.get('created') && <div className="notice" role="status">สร้างชุดข้อสอบเรียบร้อย — ฐานข้อมูลตรวจกฎการประกอบชุดผ่านทุกข้อแล้ว</div>}

      {(warnings.length > 0 || infos.length > 0) && (
        <ul className="qa-list" data-testid="exam-notices">
          {warnings.map((w, i) => <li key={`w${i}`} className="qa-alert">{w.message}</li>)}
          {infos.map((w, i) => <li key={`i${i}`} className="qa-warn">{w.message}</li>)}
        </ul>
      )}

      <div className="cards">
        <div className="card"><div className="stat-label">ข้อยึดค่า</div><div className="stat-value" data-testid="stat-anchor">{anchors}</div>
          <div className="hint-line">{Math.round((anchors / exam.itemCount) * 100)}% ของชุด</div></div>
        <div className="card"><div className="stat-label">ข้อ n น้อย</div><div className="stat-value">{exam.itemCount - anchors}</div></div>
        <div className="card"><div className="stat-label">ห้ามสลับตัวเลือก</div><div className="stat-value">{noShuffle}</div></div>
      </div>

      <section className="card">
        <h2>การกระจายเฉลยแต่ละชุด</h2>
        <div className="table-wrap">
          <table className="balance" data-testid="balance">
            <thead><tr><th>ชุด</th>{CIRCLE.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {exam.sets.map((s) => (
                <tr key={s.setNo}><th>ชุดที่ {s.setNo}</th>{counts(s.entries).map((c, k) => <td key={k}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>ลำดับข้อและเฉลยรายชุด</h2>
        <div className="tabs" role="group" aria-label="เลือกชุด">
          {exam.sets.map((s) => (
            <button key={s.setNo} type="button" aria-pressed={current.setNo === s.setNo} onClick={() => setSetNo(s.setNo)}>ชุดที่ {s.setNo}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="set-table" data-testid="set-table">
            <thead><tr><th>ข้อ</th><th>เฉลย</th><th>รหัสข้อ</th><th>ตัวชี้วัด</th><th>ระดับ</th></tr></thead>
            <tbody>
              {current.entries.map((e) => {
                const it = itemById.get(e.itemId)!;
                return (
                  <tr key={e.position}>
                    <td>{e.position}</td>
                    <td className="key">{CIRCLE[e.key - 1]}</td>
                    <td className="mono">{it.itemCode}</td>
                    <td>{ind(it.indicatorId)}</td>
                    <td>{diff(it.difficulty)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>เลขที่ → ชุด</h2>
        <ul className="seat-grid" data-testid="seats">
          {exam.seats.map((s) => <li key={s.seatNo}><b>{s.seatNo}</b><span>ชุด {s.setNo}</span></li>)}
        </ul>
      </section>

      <section className="card">
        <h2>ข้อในชุด (ลำดับมาตรฐาน)</h2>
        <ol className="exam-items" data-testid="exam-items">
          {exam.items.map((it) => (
            <li key={it.itemId}>
              <div className="item-top">
                {canOpenItems ? <a className="code" href={`#/items/${it.itemId}`}>{it.itemCode}</a> : <strong className="code">{it.itemCode}</strong>}
                <span className="meta">{ind(it.indicatorId)} · {diff(it.difficulty)} · v{it.version} · n {it.n}</span>
                {it.isAnchor && <span className="chip st-active">ยึดค่า</span>}
                {it.noShuffle && <span className="chip">ห้ามสลับ</span>}
              </div>
              <div className="item-stem">{it.content.stem}</div>
            </li>
          ))}
        </ol>
      </section>

      {exam.status === 'draft' && !exam.hasResponses && (
        <div className="actions">
          {!confirmDelete
            ? <button className="btn danger-ghost" onClick={() => setConfirmDelete(true)}>ลบชุดข้อสอบนี้…</button>
            : (
              <div className="confirm" role="alertdialog" aria-label="ยืนยันการลบชุดข้อสอบ">
                <p>ลบชุดข้อสอบ "{exam.title}" ทั้งหมด? ข้อสอบในคลังไม่ถูกลบ</p>
                <div className="actions">
                  <button className="btn danger" disabled={busy} onClick={remove}>ยืนยันลบ</button>
                  <button className="btn ghost" onClick={() => setConfirmDelete(false)}>ยกเลิก</button>
                </div>
              </div>
            )}
        </div>
      )}
    </>
  );
}
