// ตรวจทานผลรายเลขที่: ครูดูกระดาษจริงแล้วยืนยัน/แก้คำตอบที่อ่านกำกวม หรือยอมรับว่าแจกผิดชุด (ไม่มีภาพเก็บไว้ — SPEC §8.1)
import { useState } from 'react';
import { repo } from '../../data';
import type { ExamDetail, ScanAnswer, ScanResponse } from '../../core/types';
import { answerLabel, score } from './grade';

const CIRCLE = ['①', '②', '③', '④'];
const OPTIONS: Array<{ v: string; a: ScanAnswer }> = [
  { v: '1', a: 1 }, { v: '2', a: 2 }, { v: '3', a: 3 }, { v: '4', a: 4 }, { v: 'none', a: null }, { v: 'multi', a: 'multi' },
];
const toV = (a: ScanAnswer) => (a === null ? 'none' : String(a));

export function ReviewPanel({ exam, response, closed, onDone }: {
  exam: ExamDetail; response: ScanResponse; closed: boolean; onDone: (r: ScanResponse | null) => void;
}) {
  const [answers, setAnswers] = useState<ScanAnswer[]>(response.answers);
  const [setNo, setSetNo] = useState(response.setNo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keys = exam.sets.find((s) => s.setNo === setNo)?.entries.map((e) => e.key) ?? [];
  const seatSet = exam.seats.find((s) => s.seatNo === response.seatNo)?.setNo ?? response.setNo;
  const ambiguous = new Set(response.flags.flatMap((f) => (f.type === 'ambiguous' && !f.resolved ? f.positions : [])));
  const wrongSet = response.flags.find((f) => f.type === 'wrong_set' && !f.resolved);
  const open = response.flags.filter((f) => !f.resolved);

  async function confirm() {
    setBusy(true); setError(null);
    try { onDone(await repo.reviewScan(exam.id, response.seatNo, setNo, answers)); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(null);
    try { await repo.deleteScan(exam.id, response.seatNo); onDone(null); } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <section className="card review" data-testid="review-panel">
      <div className="page-head">
        <h2>เลขที่ {response.seatNo} · ตรวจด้วยชุด {setNo} · <span data-testid="review-score">{score(answers, keys)}/{exam.itemCount}</span></h2>
        <button className="btn ghost" onClick={() => onDone(response)}>กลับ</button>
      </div>
      {open.length > 0 && <p className="warn-text">ดูกระดาษคำตอบจริงของเลขที่นี้ แล้วแก้ข้อที่ไฮไลต์ให้ตรง จากนั้นกด "ยืนยันผล"</p>}
      {wrongSet && wrongSet.type === 'wrong_set' && setNo !== wrongSet.suggested_set && (
        <div className="conflict">
          <p>คะแนนด้วยชุด {response.setNo} ต่ำผิดปกติ แต่ตรวจด้วย<b>ชุด {wrongSet.suggested_set}</b> ได้ {wrongSet.score_alt}/{exam.itemCount} — นักเรียนอาจได้ข้อสอบผิดชุด</p>
          <button className="btn" onClick={() => setSetNo(wrongSet.suggested_set)}>ตรวจด้วยชุด {wrongSet.suggested_set}</button>
        </div>
      )}
      <label className="inline-field">ชุดที่ใช้ตรวจ{' '}
        <select value={setNo} onChange={(e) => setSetNo(Number(e.target.value))} data-testid="review-set">
          {exam.sets.map((s) => <option key={s.setNo} value={s.setNo}>ชุด {s.setNo}{s.setNo === seatSet ? ' (ชุดของเลขที่นี้)' : ''}</option>)}
        </select>
      </label>
      <ol className="answer-grid" data-testid="answer-grid">
        {answers.map((a, i) => {
          const right = a === keys[i];
          return (
            <li key={i} className={`${ambiguous.has(i + 1) ? 'amb' : ''} ${right ? 'right' : 'wrong'}`}>
              <span className="no">{i + 1}</span>
              <select aria-label={`ข้อ ${i + 1}`} value={toV(a)} onChange={(e) => {
                const v = OPTIONS.find((o) => o.v === e.target.value)!.a;
                setAnswers((xs) => xs.map((x, k) => (k === i ? v : x)));
              }}>
                {OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.a === null || o.a === 'multi' ? answerLabel(o.a) : CIRCLE[(o.a as number) - 1]}</option>)}
              </select>
              <span className="key" title="เฉลย">{right ? '✓' : `✗ ${CIRCLE[keys[i] - 1] ?? ''}`}</span>
            </li>
          );
        })}
      </ol>
      {error && <div className="error box" role="alert">{error}</div>}
      {!closed && (
        <div className="actions wrap">
          <button className="btn" onClick={confirm} disabled={busy} data-testid="review-confirm">ยืนยันผล</button>
          {!confirmDelete
            ? <button className="btn ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>ลบผลตรวจ (เพื่อสแกนใหม่)</button>
            : <span className="confirm-inline">ลบผลของเลขที่ {response.seatNo}? <button className="btn danger" onClick={remove} disabled={busy}>ลบ</button> <button className="btn ghost" onClick={() => setConfirmDelete(false)}>ยกเลิก</button></span>}
        </div>
      )}
    </section>
  );
}
