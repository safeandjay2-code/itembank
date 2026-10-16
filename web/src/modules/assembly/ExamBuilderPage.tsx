// หน้าสร้างชุดข้อสอบ (SPEC §6.1): จำนวนข้อ → จำนวนชุด → ตัวชี้วัด/ระดับ/จำนวน (หลายแถว) → จำนวนนักเรียน → "สร้างข้อสอบ"
// อัลกอริทึมเลือก/เรียง/สลับทำงานในเบราว์เซอร์ แล้วฐานข้อมูลตรวจกฎซ้ำก่อนบันทึก
// One Stop เฟส 3: เลือกห้อง + ประเภทการสอบ (เก็บคะแนน/ปลายภาค/ฝึก) + สอบซ่อม → บันทึกพร้อมชุดในคำสั่งเดียว
//   ?classroom=<id> = มาจากหน้าห้องเรียน (เลือกห้องนั้น ประเภทเก็บคะแนนไว้ให้)
import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import type { AssemblyRow, ClassroomDetail, ClassroomSummary, ExamLink, ExamSummary, PoolItem } from '../../core/types';
import { ExamLinkFields } from '../gradebook/ExamLinkFields';
import { PRACTICE_LINK, linkProblems, unplannedIndicators } from '../gradebook/examLink';
import { navigate, type Route } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { buildPlan, cellKey, checkRequest, configFromSettings, isAnchor, makeOrdering, type Names } from './assemble';
import { validatePlan } from './validate';
import { planToCreateInput } from './payload';
import { randomSeed } from './rng';

interface RowState extends AssemblyRow { key: number }
let rowSeq = 0;
const newRow = (difficulty = 1): RowState => ({ key: ++rowSeq, indicatorId: '', difficulty, count: 1 });
const toInt = (s: string) => (s.trim() === '' ? NaN : Number(s));

export function ExamBuilderPage({ route }: { route: Route }) {
  const { data: ref, error: refError } = useRefData();
  const [pool, setPool] = useState<PoolItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gradeId, setGradeId] = useState(route.params.get('grade') ?? '');
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [itemCount, setItemCount] = useState('20');
  const [setCount, setSetCount] = useState('2');
  const [studentCount, setStudentCount] = useState('30');
  const [rows, setRows] = useState<RowState[]>(() => [newRow()]);
  const [otherGrades, setOtherGrades] = useState(false);
  const fromRoom = route.params.get('classroom');
  const [link, setLink] = useState<ExamLink>(fromRoom ? { classroomId: fromRoom, purpose: 'collect', retakeOf: null } : PRACTICE_LINK);
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [roomDetail, setRoomDetail] = useState<ClassroomDetail | null>(null);

  useEffect(() => { repo.getAssemblyPool('MATH').then(setPool, (e) => setError((e as Error).message)); }, []);
  useEffect(() => {
    repo.listClassrooms().then((cs) => setClassrooms(cs.filter((c) => c.status === 'open')), () => setClassrooms([]));
    repo.listExams('MATH').then(setExams, () => setExams([]));
  }, []);
  const room = classrooms.find((c) => c.id === link.classroomId);
  // เลือกห้องแล้ว: ชั้นตามห้อง · จำนวนนักเรียนครบห้อง (สอบซ่อมไม่บังคับ แก้เองได้)
  useEffect(() => {
    if (!room) { setRoomDetail(null); return; }
    if (room.gradeId !== gradeId) changeGrade(room.gradeId);
    if (!link.retakeOf) setStudentCount(String(room.studentCount));
    repo.getClassroom(room.id).then(setRoomDetail, () => setRoomDetail(null));
  }, [room?.id, link.retakeOf]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref && !gradeId) setGradeId(ref.grades[0]?.id ?? ''); }, [ref, gradeId]);
  const grade = ref?.grades.find((g) => g.id === gradeId);
  const autoTitle = !grade ? '' : `${link.retakeOf ? 'สอบซ่อม' : 'แบบทดสอบ'}${link.purpose === 'final' ? 'ปลายภาค' : ''} คณิตศาสตร์ ${room ? room.name : grade.shortTh}`;
  useEffect(() => { if (autoTitle && !titleEdited) setTitle(autoTitle); }, [autoTitle, titleEdited]);

  const cfg = useMemo(() => (ref ? configFromSettings(ref.settings) : null), [ref]);
  const names: Names = useMemo(() => ({
    indicator: (id) => ref?.indicatorById.get(id)?.code ?? id,
    difficulty: (id) => `ระดับ${ref?.difficulties.find((d) => d.id === id)?.nameTh ?? id}`,
  }), [ref]);
  const req = { gradeId, itemCount: toInt(itemCount), setCount: toInt(setCount), studentCount: toInt(studentCount),
    rows: rows.map(({ indicatorId, difficulty, count }) => ({ indicatorId, difficulty, count })) };
  const check = pool && cfg ? checkRequest(req, pool, cfg, names) : null;

  const cellStats = useMemo(() => {
    const m = new Map<string, { total: number; anchors: number }>();
    if (pool && cfg) for (const p of pool) {
      const k = cellKey(p.indicatorId, p.difficulty);
      const c = m.get(k) ?? { total: 0, anchors: 0 };
      c.total += 1; if (isAnchor(p, cfg)) c.anchors += 1;
      m.set(k, c);
    }
    return m;
  }, [pool, cfg]);
  const requestedPerCell = new Map<string, number>();
  rows.forEach((r) => { if (r.indicatorId) requestedPerCell.set(cellKey(r.indicatorId, r.difficulty), (requestedPerCell.get(cellKey(r.indicatorId, r.difficulty)) ?? 0) + (r.count || 0)); });

  const indicatorOptions = (ref?.indicators ?? []).filter((i) => otherGrades || i.gradeId === gradeId);
  const gradeShort = (id: string) => ref?.grades.find((g) => g.id === id)?.shortTh ?? id;

  function patchRow(key: number, patch: Partial<AssemblyRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function changeGrade(id: string) {
    setGradeId(id);
    if (!otherGrades) setRows((rs) => rs.map((r) => (r.indicatorId && ref?.indicatorById.get(r.indicatorId)?.gradeId !== id ? { ...r, indicatorId: '' } : r)));
  }

  async function create() {
    if (!pool || !cfg || !ref || !check?.ready) return;
    setBusy(true); setError(null);
    try {
      const ordering = makeOrdering(ref.indicators, ref.grades, ref.difficulties);
      const plan = buildPlan(req, pool, cfg, ordering, randomSeed(), names);
      const violations = validatePlan(plan, req, pool, cfg, ordering);
      if (violations.length) throw new Error(`ตรวจชุดข้อสอบไม่ผ่าน: ${violations[0]}`);
      const input = planToCreateInput(plan, req, { title, subjectId: 'MATH' });
      const id = await repo.createExam(link.purpose === 'practice' && !link.classroomId ? input : { ...input, link });
      navigate(`/exams/${id}`, { created: 1 });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const target = Number.isInteger(req.itemCount) && req.itemCount > 0 ? req.itemCount : 0;
  const selected = check?.selected ?? 0;
  const counterState = !target ? '' : selected === target ? 'ok' : selected > target ? 'over' : 'under';
  const blocking = check?.errors.filter((e) => e.code !== 'count_mismatch' && e.code !== 'no_rows') ?? [];
  const problems = linkProblems(link, { gradeId, studentCount: req.studentCount }, room);
  const unplanned = link.purpose === 'collect' && roomDetail ? unplannedIndicators(rows.map((r) => r.indicatorId), roomDetail.columns) : [];

  return (
    <>
      <div className="crumb"><a href="#/exams">ชุดข้อสอบ</a> › สร้างใหม่</div>
      <h1>สร้างชุดข้อสอบ</h1>
      <p className="sub">ระบบเลือกข้อที่ใช้น้อยก่อน ผสมข้อยึดค่า เรียงตามตัวชี้วัด ง่าย→ยาก แล้วสลับข้อและตัวเลือกให้แต่ละชุดเอง</p>
      {(error || refError) && <div className="error" role="alert">{error || refError}</div>}

      <section className="card builder-step" data-testid="link-step">
        <h2><span className="step-no">0</span> ใช้สอบแบบไหน</h2>
        <ExamLinkFields link={link} onChange={setLink} classrooms={classrooms} exams={exams} gradeShort={gradeShort} />
      </section>

      <section className="card builder-step">
        <h2><span className="step-no">1–2</span> ข้อสอบและจำนวนชุด</h2>
        <div className="tabs" role="group" aria-label="เลือกชั้น">
          {ref?.grades.map((g) => (
            <button key={g.id} type="button" aria-pressed={gradeId === g.id} disabled={!!room && room.gradeId !== g.id}
              title={room && room.gradeId !== g.id ? `ห้อง ${room.name} เป็นชั้น ${gradeShort(room.gradeId)}` : undefined}
              onClick={() => changeGrade(g.id)}>{g.shortTh}</button>
          ))}
        </div>
        <div className="field-grid builder-fields">
          <label className="wide">ชื่อแบบทดสอบ
            <input value={title} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }} maxLength={200} />
          </label>
          <label>จำนวนข้อ
            <input type="number" inputMode="numeric" min={1} value={itemCount} onChange={(e) => setItemCount(e.target.value)} />
          </label>
          <label>จำนวนชุด (กันลอก)
            <input type="number" inputMode="numeric" min={1} max={cfg?.maxSets} value={setCount} onChange={(e) => setSetCount(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card builder-step">
        <h2><span className="step-no">3</span> เลือกตัวชี้วัด ระดับ และจำนวนข้อ</h2>
        <div className="builder-counter">
          <span className={`counter ${counterState}`} data-testid="selected-counter">เลือกแล้ว {selected}/{target || '–'}</span>
          <label className="check">
            <input type="checkbox" checked={otherGrades} onChange={(e) => setOtherGrades(e.target.checked)} />
            รวมตัวชี้วัดชั้นอื่น (ทบทวน)
          </label>
        </div>
        <ol className="row-list" data-testid="rows">
          {rows.map((r, k) => {
            const stat = r.indicatorId ? cellStats.get(cellKey(r.indicatorId, r.difficulty)) ?? { total: 0, anchors: 0 } : null;
            const wanted = r.indicatorId ? requestedPerCell.get(cellKey(r.indicatorId, r.difficulty)) ?? 0 : 0;
            const short = !!stat && wanted > stat.total;
            return (
              <li key={r.key} className={`row-edit${short ? ' short' : ''}`}>
                <label className="row-ind">ตัวชี้วัด
                  <select aria-label={`ตัวชี้วัด แถว ${k + 1}`} value={r.indicatorId} onChange={(e) => patchRow(r.key, { indicatorId: e.target.value })}>
                    <option value="">— เลือกตัวชี้วัด —</option>
                    {indicatorOptions.map((i) => (
                      <option key={i.id} value={i.id}>{i.code}{otherGrades && i.gradeId !== gradeId ? ` (${gradeShort(i.gradeId)})` : ''}</option>
                    ))}
                  </select>
                </label>
                <label>ระดับ
                  <select aria-label={`ระดับ แถว ${k + 1}`} value={r.difficulty} onChange={(e) => patchRow(r.key, { difficulty: Number(e.target.value) })}>
                    {ref?.difficulties.map((d) => <option key={d.id} value={d.id}>{d.nameTh}</option>)}
                  </select>
                </label>
                <label className="row-count">จำนวน
                  <input aria-label={`จำนวน แถว ${k + 1}`} type="number" inputMode="numeric" min={1} value={Number.isNaN(r.count) ? '' : r.count}
                    onChange={(e) => patchRow(r.key, { count: toInt(e.target.value) })} />
                </label>
                <button type="button" className="btn ghost row-remove" aria-label={`ลบแถว ${k + 1}`} disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>✕</button>
                <div className="row-avail" data-testid={`avail-${k + 1}`}>
                  {stat ? <>มีในคลัง {stat.total} ข้อ{stat.anchors ? ` · ยึดค่า ${stat.anchors}` : ''}{short ? ` — ขอ ${wanted} ข้อ เกินที่มี` : ''}</> : pool ? 'เลือกตัวชี้วัดเพื่อดูจำนวนข้อในคลัง' : 'กำลังโหลดคลัง…'}
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn ghost" onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1]?.difficulty ?? 1)])}>+ เพิ่มแถว</button>
      </section>

      <section className="card builder-step">
        <h2><span className="step-no">5</span> จำนวนนักเรียน</h2>
        <div className="field-grid builder-fields">
          <label>จำนวนนักเรียน (เลขที่ 1–N)
            <input type="number" inputMode="numeric" min={1} max={cfg?.maxStudents} value={studentCount} onChange={(e) => setStudentCount(e.target.value)} />
          </label>
        </div>
        <p className="hint-line">ระบบกำหนดชุดตามเลขที่แบบวนรอบ (เลขที่ 1 ชุด 1, เลขที่ 2 ชุด 2, …) นักเรียนไม่ต้องฝนชุด</p>
        {room && !link.retakeOf && <p className="hint-line">ชุดของห้อง {room.name} ต้องมีเลขที่ครบทั้งห้อง ({room.studentCount} คน) — เลขที่ที่ไม่ได้สอบนับตาม "ขาดสอบ" ในตั้งค่าห้อง</p>}
      </section>

      {unplanned.length > 0 && (
        <div className="notice" data-testid="unplanned">
          ตัวชี้วัด {unplanned.map((i) => ref?.indicatorById.get(i)?.code ?? i).join(', ')} ยังไม่มีช่องในห้อง {room?.name} — คะแนนเก็บไว้แล้ว
          แต่จะลงสมุดเมื่อ<a href={`#/classes/${room?.id}`}>เพิ่มช่องตัวชี้วัดนี้ในห้อง</a> (เพิ่มเมื่อไรคะแนนก็มา)
        </div>
      )}
      {problems.length > 0 && (
        <ul className="qa-list" data-testid="link-errors">{problems.map((m, i) => <li key={i} className="qa-error">{m}</li>)}</ul>
      )}
      {check && check.errors.length > 0 && (
        <ul className="qa-list" data-testid="build-errors">
          {(blocking.length ? blocking : check.errors).map((e, i) => <li key={i} className="qa-error">{e.message}</li>)}
        </ul>
      )}
      <div className="actions">
        <button className="btn" disabled={!check?.ready || busy || problems.length > 0} onClick={create}>{busy ? 'กำลังสร้าง…' : 'สร้างข้อสอบ'}</button>
        <a className="btn ghost" href="#/exams">ยกเลิก</a>
      </div>
    </>
  );
}
