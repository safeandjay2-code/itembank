// สร้างห้องเรียน/เทอม (One Stop เฟส 2): จำนวนนักเรียน → เลือกตัวชี้วัด → คะแนน (ค่าเริ่มต้น 70-30 ไม่บังคับรวม 100)
import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { navigate } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { currentTerm, fmtScore, gradebookDefaults, parseMaxScore, splitIndicatorCode, splitTotal } from './plan';

export function ClassroomNewPage() {
  const { data: ref, error: refError } = useRefData();
  const d = useMemo(() => gradebookDefaults(ref?.settings), [ref]);
  const now = currentTerm();
  const [gradeId, setGradeId] = useState('P4');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [year, setYear] = useState(String(now.academicYear));
  const [term, setTerm] = useState(String(now.term));
  const [students, setStudents] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [otherGrades, setOtherGrades] = useState(false);
  const [autoSplit, setAutoSplit] = useState(true);
  const [indTotal, setIndTotal] = useState('');
  const [finalMax, setFinalMax] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ref) return;
    setIndTotal((v) => v || String(d.indicatorTotal));
    setFinalMax((v) => v || String(d.finalMax));
  }, [ref, d]);
  useEffect(() => {
    const g = ref?.grades.find((x) => x.id === gradeId);
    if (g && !nameEdited) setName(`${g.shortTh}/1`);
  }, [ref, gradeId, nameEdited]);

  const indicators = (ref?.indicators ?? []).filter((i) => otherGrades || i.gradeId === gradeId);
  // ลำดับที่เลือก = ลำดับตามหลักสูตร (ชั้นของห้องก่อน) — เรียงตามแผนการสอนได้ในหน้าตั้งค่าห้อง
  const ordered = (ref?.indicators ?? []).filter((i) => picked.includes(i.id))
    .sort((a, b) => (a.gradeId === gradeId ? 0 : 1) - (b.gradeId === gradeId ? 0 : 1) || a.gradeId.localeCompare(b.gradeId) || a.sort - b.sort);
  const totalParsed = parseMaxScore(indTotal);
  const finalParsed = parseMaxScore(finalMax);
  const split = autoSplit && totalParsed.ok && totalParsed.value !== null ? splitTotal(totalParsed.value, ordered.length) : null;
  const collectSum = split ? split.reduce((a, b) => a + b, 0) : 0;
  const finalVal = finalParsed.ok ? finalParsed.value ?? d.finalMax : 0;

  function changeGrade(g: string) {
    setGradeId(g);
    if (!otherGrades) setPicked([]);
  }
  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  const gradeIndicators = (ref?.indicators ?? []).filter((i) => i.gradeId === gradeId);
  const allPicked = gradeIndicators.length > 0 && gradeIndicators.every((i) => picked.includes(i.id));

  async function create() {
    setError(null);
    const n = Number(students);
    if (!name.trim()) return setError('ใส่ชื่อห้อง เช่น ป.5/1');
    if (!Number.isInteger(n) || n < 1) return setError('ใส่จำนวนนักเรียน (เลขที่ 1 ถึงจำนวนนี้)');
    if (n > d.maxStudents) return setError(`จำนวนนักเรียนต้องไม่เกิน ${d.maxStudents} คน`);
    if (!finalParsed.ok) return setError(`คะแนนปลายภาค: ${finalParsed.error}`);
    if (autoSplit && !totalParsed.ok) return setError(`คะแนนรวมตัวชี้วัด: ${totalParsed.error}`);
    setBusy(true);
    try {
      const id = await repo.createClassroom({
        gradeId, academicYear: Number(year), term: Number(term), name: name.trim(), studentCount: n,
        finalMax: finalParsed.value,   // ว่าง = ค่าเริ่มต้นของระบบ
        indicators: ordered.map((i, k) => ({ indicatorId: i.id, maxScore: split ? split[k] : null })),
      });
      navigate(`/classes/${id}`, { created: 1 }, true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <p className="crumb"><a href="#/classes">← ห้องเรียน</a></p>
      <h1>สร้างห้องเรียน</h1>
      <p className="sub">ใส่แค่จำนวนนักเรียน ระบบใช้เลขที่ 1–N ไม่เก็บชื่อ · เลือกตัวชี้วัดทีหลังหรือเพิ่มระหว่างเทอมก็ได้</p>
      {(error || refError) && <div className="error box" role="alert">{error || refError}</div>}

      <section className="card builder-step">
        <h2><span className="step-no">1</span> ห้องและภาคเรียน</h2>
        <div className="tabs" role="group" aria-label="เลือกชั้น">
          {ref?.grades.map((g) => (
            <button key={g.id} type="button" aria-pressed={gradeId === g.id} onClick={() => changeGrade(g.id)}>{g.shortTh}</button>
          ))}
        </div>
        <div className="field-grid builder-fields">
          <label>ชื่อห้อง
            <input value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setNameEdited(true); }} />
          </label>
          <label>จำนวนนักเรียน (เลขที่ 1–N)
            <input type="number" inputMode="numeric" min={1} max={d.maxStudents} value={students} onChange={(e) => setStudents(e.target.value)} />
          </label>
          <label>ปีการศึกษา
            <input type="number" inputMode="numeric" min={2500} max={2700} value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label>ภาคเรียน
            <select value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="1">1</option><option value="2">2</option><option value="3">3 (ฤดูร้อน)</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card builder-step">
        <h2><span className="step-no">2</span> ตัวชี้วัดที่จะสอนเทอมนี้</h2>
        <div className="builder-counter">
          <span className="counter" data-testid="picked-counter">เลือกแล้ว {ordered.length} ตัว</span>
          <button type="button" className="btn ghost" onClick={() => setPicked((p) => allPicked
            ? p.filter((x) => !gradeIndicators.some((i) => i.id === x))
            : [...p, ...gradeIndicators.map((i) => i.id).filter((x) => !p.includes(x))])}>
            {allPicked ? 'ไม่เลือกทั้งหมด' : 'เลือกทั้งชั้น'}
          </button>
          <label className="check">
            <input type="checkbox" checked={otherGrades} onChange={(e) => setOtherGrades(e.target.checked)} />
            แสดงตัวชี้วัดชั้นอื่น
          </label>
        </div>
        <ul className="pick-list" data-testid="indicator-picks">
          {indicators.map((i) => {
            const c = splitIndicatorCode(i.code);
            const k = ordered.findIndex((x) => x.id === i.id);
            return (
              <li key={i.id}>
                <label className="pick">
                  <input type="checkbox" checked={picked.includes(i.id)} onChange={() => toggle(i.id)} aria-label={i.code} />
                  <span className="ind-code">{c.standard} {c.indicator}</span>
                  <span className="ind-text">{i.text}</span>
                  {split && k >= 0 && <span className="chip" data-testid="pick-score">{split[k]} คะแนน</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="hint" style={{ marginTop: 6 }}>ไม่เลือกเลยก็ได้ — สอนตัวไหนค่อยเพิ่มตัวนั้นในหน้าตั้งค่าห้อง</p>
      </section>

      <section className="card builder-step">
        <h2><span className="step-no">3</span> คะแนน</h2>
        <div className="field-grid builder-fields">
          <label>คะแนนรวมตัวชี้วัด
            <input inputMode="decimal" value={indTotal} disabled={!autoSplit} onChange={(e) => setIndTotal(e.target.value)} />
          </label>
          <label>คะแนนสอบปลายภาค
            <input inputMode="decimal" value={finalMax} onChange={(e) => setFinalMax(e.target.value)} />
          </label>
          <label className="check wide">
            <input type="checkbox" checked={autoSplit} onChange={(e) => setAutoSplit(e.target.checked)} />
            แบ่งคะแนนรวมให้ตัวชี้วัดเท่า ๆ กัน (ปรับรายตัวได้ทีหลัง) — ไม่ติ๊ก = ยังไม่ตั้งคะแนน
          </label>
        </div>
        <p className="score-sum" data-testid="create-sum">
          {autoSplit && ordered.length > 0
            ? <>ตัวชี้วัด {fmtScore(collectSum)} + ปลายภาค {fmtScore(finalVal)} = <strong>{fmtScore(collectSum + finalVal)}</strong></>
            : <>ปลายภาค {fmtScore(finalVal)} · ตัวชี้วัดยังไม่ตั้งคะแนน</>}
          <span className="hint-line">ไม่บังคับให้รวมเป็น 100 — ค่าเริ่มต้น {d.indicatorTotal}-{d.finalMax} ตามที่โรงเรียนใช้</span>
        </p>
      </section>

      <div className="actions">
        <button className="btn" onClick={create} disabled={busy || !ref}>{busy ? 'กำลังสร้าง…' : 'สร้างห้องเรียน'}</button>
        <a className="btn ghost" href="#/classes">ยกเลิก</a>
      </div>
    </>
  );
}
