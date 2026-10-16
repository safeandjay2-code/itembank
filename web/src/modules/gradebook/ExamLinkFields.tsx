// ช่องเลือก "ใช้กับห้องไหน · ประเภทการสอบ · สอบซ่อมของชุดไหน" — ใช้ทั้งหน้าสร้างชุดและหน้ารายละเอียดชุด (One Stop เฟส 3)
import { EXAM_PURPOSE_TH, type ClassroomSummary, type ExamLink, type ExamPurpose, type ExamSummary } from '../../core/types';
import { PURPOSE_HINT, retakeCandidates } from './examLink';

const PURPOSES: ExamPurpose[] = ['collect', 'final', 'practice'];

export function ExamLinkFields({ link, onChange, classrooms, exams, selfId, gradeShort }: {
  link: ExamLink;
  onChange: (l: ExamLink) => void;
  /** เฉพาะห้องที่เปิดอยู่ */
  classrooms: ClassroomSummary[];
  exams: ExamSummary[];
  selfId?: string;
  gradeShort: (id: string) => string;
}) {
  const candidates = retakeCandidates(exams, link.classroomId, link.purpose, selfId);
  const setPurpose = (purpose: ExamPurpose) => onChange(purpose === 'practice'
    ? { classroomId: null, purpose, retakeOf: null }
    : { classroomId: link.classroomId ?? (classrooms.length === 1 ? classrooms[0].id : null), purpose, retakeOf: null });

  return (
    <div className="link-fields" data-testid="link-fields">
      <div className="tabs" role="group" aria-label="ประเภทการสอบ">
        {PURPOSES.map((p) => (
          <button key={p} type="button" aria-pressed={link.purpose === p} onClick={() => setPurpose(p)}>{EXAM_PURPOSE_TH[p]}</button>
        ))}
      </div>
      <p className="hint-line" data-testid="purpose-hint">{PURPOSE_HINT[link.purpose]}</p>
      {link.purpose !== 'practice' && (
        classrooms.length === 0
          ? <p className="error box" data-testid="no-classrooms">ยังไม่มีห้องเรียนที่เปิดอยู่ — <a href="#/classes/new">สร้างห้องเรียน</a>ก่อน หรือเลือก "ฝึก/วินิจฉัย"</p>
          : (
            <div className="field-grid builder-fields">
              <label>ห้องเรียน
                <select aria-label="ห้องเรียน" value={link.classroomId ?? ''} onChange={(e) => onChange({ ...link, classroomId: e.target.value || null, retakeOf: null })}>
                  <option value="">— เลือกห้อง —</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({gradeShort(c.gradeId)} · {c.term}/{c.academicYear} · {c.studentCount} คน)</option>
                  ))}
                </select>
              </label>
              <label>สอบซ่อม/สอบซ้ำ
                <select aria-label="สอบซ่อม/สอบซ้ำ" value={link.retakeOf ?? ''} disabled={!link.classroomId}
                  onChange={(e) => onChange({ ...link, retakeOf: e.target.value || null })}>
                  <option value="">ไม่ใช่ — เป็นการสอบครั้งแรก</option>
                  {candidates.map((e) => <option key={e.id} value={e.id}>สอบซ่อมของ: {e.title}</option>)}
                </select>
              </label>
            </div>
          )
      )}
      {link.retakeOf && <p className="hint-line">สอบซ่อมใช้เลขที่เดิมของห้อง ไม่ต้องสอบครบทุกคน · ห้องนับครั้งไหนตาม "วิธีนับสอบซ่อม" ในหน้าตั้งค่าห้อง</p>}
    </div>
  );
}
