// หน้าเพิ่ม/แก้ไขข้อสอบ: ข้อมูลกำกับ, โจทย์, รูป, ตัวเลือก + ตัวลวง, เฉลย, วิธีคิด
// ตรวจคุณภาพอัตโนมัติสด ๆ ระหว่างพิมพ์ (SPEC §5.6) และเลือกการบันทึกตามกฎเวอร์ชัน (SPEC §5.4)
import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { STATUS_TH, type ItemDetail, type ItemDraft, type ItemStatus, type SaveMode } from '../../core/types';
import { href, navigate } from '../../ui/router';
import { useRefData, type RefData } from './useRefData';
import { runQa } from './qa';
import { classifyEdit, emptyContent, stableJson, statusChangeBlocked } from './rules';
import { evaluate } from './rational';
import { FigureEditor } from './FigureEditor';
import { ItemPreview } from './ItemPreview';
import { StatusChip } from './ItemListPage';
import { DEFAULT_FIGURE_NOTE } from './figure/svg';

const EVENT_TH: Record<string, string> = {
  created: 'สร้างข้อ', status_changed: 'เปลี่ยนสถานะ', difficulty_changed: 'ย้ายระดับความยาก',
  version_changed: 'ขึ้นเวอร์ชันใหม่', version_edited: 'แก้คำผิด/รูปแบบ (เวอร์ชันเดิม)', meta_changed: 'แก้ข้อมูลกำกับ',
  note: 'หมายเหตุ', imported: 'นำเข้าจากไฟล์',
};

function draftFrom(d: ItemDetail): ItemDraft {
  const v = d.versions.find((x) => x.version === d.currentVersion)!;
  const c = structuredClone(v.content);
  return {
    indicatorId: d.indicatorId, itemType: d.itemType, cognitiveLevel: d.cognitiveLevel, estDifficulty: d.estDifficulty,
    noShuffle: d.noShuffle, tags: [...d.tags], subtopic: d.subtopic,
    content: { ...emptyContent(), ...c, distractor_rationale: c.distractor_rationale ?? [null, null, null, null], check: c.check ?? null },
    answer: structuredClone(v.answer),
  };
}

function newDraft(ref: RefData, ind: string | null, d: string | null): ItemDraft {
  return {
    indicatorId: ind && ref.indicatorById.has(ind) ? ind : '', itemType: 'mcq4', cognitiveLevel: 2,
    estDifficulty: d ? Number(d) : 1, noShuffle: false, tags: [], subtopic: null,
    content: emptyContent(), answer: { choice: 0 },
  };
}

/** ข้อความแจ้งผลที่ต้องแสดงหลังเปลี่ยนหน้า (บันทึกข้อใหม่แล้วไปหน้าของข้อนั้น) */
let pendingMessage: string | null = null;

const fmtDate = (s: string) => new Date(s).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

function describeEvent(e: { type: string; payload: Record<string, unknown> }, ref: RefData): string {
  const p = e.payload as any;
  const diff = (id: number) => ref.difficulties.find((d) => d.id === id)?.nameTh ?? id;
  switch (e.type) {
    case 'status_changed': return `${STATUS_TH[p.from as ItemStatus] ?? p.from} → ${STATUS_TH[p.to as ItemStatus] ?? p.to}`;
    case 'difficulty_changed': return `${diff(p.from)} → ${diff(p.to)}`;
    case 'version_changed': return `v${p.from} → v${p.to}`;
    case 'version_edited': return `v${p.version}${p.note ? ` · ${p.note}` : ''}`;
    case 'note': return String(p.text ?? '');
    case 'imported': return p.mode === 'restore' ? 'กู้คืนจากไฟล์สำรอง' : 'ข้อใหม่';
    default: return '';
  }
}

export function ItemEditorPage({ id, params }: { id: string | null; params: URLSearchParams }) {
  const { data: ref, error: refError } = useRefData();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [initial, setInitial] = useState<string>('');
  const [gradeSel, setGradeSel] = useState<string>('');
  const [tagsText, setTagsText] = useState('');
  const [userMode, setUserMode] = useState<SaveMode | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'edit' | 'history'>('edit');
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notFound, setNotFound] = useState(false);

  function adopt(d: ItemDraft) {
    setDraft(d); setInitial(stableJson(d)); setTagsText(d.tags.join(', ')); setUserMode(null); setNote('');
    if (ref) setGradeSel(ref.indicatorById.get(d.indicatorId)?.gradeId ?? ref.grades[0]?.id ?? '');
  }

  async function load() {
    if (!ref) return;
    if (!id) { adopt(newDraft(ref, params.get('ind'), params.get('d'))); setItem(null); return; }
    try {
      const it = await repo.getItem(id);
      if (!it) { setNotFound(true); return; }
      setItem(it); adopt(draftFrom(it));
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    if (!ref) return;
    setMessage(pendingMessage); pendingMessage = null; setError(null); setTab('edit'); load();
  }, [ref, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const requireCheck = ref?.settings['qa.require_answer_check'] === true;
  const figureNote = (ref?.settings['print.figure_note'] as string | undefined) ?? DEFAULT_FIGURE_NOTE;
  const qa = useMemo(() => draft ? runQa(draft.content, draft.answer, { requireCheck, noShuffle: draft.noShuffle }) : null,
    [draft, requireCheck]);
  const cur = item?.versions.find((v) => v.version === item.currentVersion);
  const edit = useMemo(() => (cur && draft ? classifyEdit(cur.content, cur.answer, draft.content, draft.answer) : null), [cur, draft]);
  const mode: SaveMode = !item ? 'new' : !edit?.minorAllowed ? 'major' : userMode ?? (edit.suggestMajor ? 'major' : 'minor');
  const dirty = draft ? stableJson(draft) !== initial : false;
  const checkResult = useMemo(() => {
    const c = draft?.content.check?.trim();
    if (!c) return null;
    try { return { ok: true, text: evaluate(c).toString() }; } catch (e) { return { ok: false, text: (e as Error).message }; }
  }, [draft?.content.check]);

  if (notFound) return <div className="card">ไม่พบข้อสอบนี้ · <a href={href('/items')}>กลับไปคลังข้อสอบ</a></div>;
  if (refError || (!draft && error)) return <div className="error" role="alert">{refError || error}</div>;
  if (!ref || !draft || !qa) return <p className="sub">กำลังโหลด…</p>;

  const upd = (f: (d: ItemDraft) => void) => setDraft((d) => { const n = structuredClone(d!); f(n); return n; });
  const setOption = (i: number, v: string) => upd((d) => { d.content.options[i] = v; });
  const setRationale = (i: number, v: string) => upd((d) => { d.content.distractor_rationale[i] = v || null; });

  async function save(thenReview: boolean) {
    if (!draft || !qa) return;
    if (!draft.indicatorId) { setError('กรุณาเลือกตัวชี้วัด'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      // ตำแหน่งเฉลยไม่มีเหตุผลตัวลวง
      const toSave = structuredClone(draft);
      toSave.content.distractor_rationale = toSave.content.options.map((_, i) =>
        i + 1 === toSave.answer.choice ? null : toSave.content.distractor_rationale[i] ?? null);
      const newId = await repo.saveItem({ id: item?.id, draft: toSave, mode, changeNote: note.trim() || null, qa });
      if (thenReview) await repo.setItemStatus(newId, 'reviewed', 'ยืนยันตรวจแล้วตอนบันทึก');
      const saved = await repo.getItem(newId);
      const msg = mode === 'new' ? `บันทึกข้อใหม่แล้ว (${saved?.itemCode})`
        : mode === 'major' ? `บันทึกเป็นเวอร์ชัน ${saved?.currentVersion} แล้ว` : 'บันทึกแล้ว (เวอร์ชันเดิม)';
      const full = msg + (thenReview ? ' · ยืนยันตรวจแล้ว' : '');
      if (!item) { pendingMessage = full; navigate(`/items/${newId}`, undefined, true); return; }
      if (saved) { setItem(saved); adopt(draftFrom(saved)); }
      setMessage(full);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function changeStatus(s: ItemStatus) {
    if (!item) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await repo.setItemStatus(item.id, s);
      const saved = await repo.getItem(item.id);
      if (saved) setItem(saved);
      setMessage(`เปลี่ยนสถานะเป็น "${STATUS_TH[s]}" แล้ว`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!item) return;
    setBusy(true); setError(null);
    try { await repo.deleteItem(item.id); navigate('/items', { ind: item.indicatorId }); }
    catch (e) { setError((e as Error).message); setConfirmDelete(false); }
    finally { setBusy(false); }
  }

  const inds = ref.indicators.filter((i) => i.gradeId === gradeSel);
  const ind = ref.indicatorById.get(draft.indicatorId);
  const savedQaPassed = cur?.qa ? cur.qa.passed : null;
  const statusTargets: ItemStatus[] = ['draft', 'reviewed', 'active', 'needs_fix', 'retired'];
  const shownVersion = viewVersion !== null ? item?.versions.find((v) => v.version === viewVersion) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumb"><a href={href('/items', { ind: draft.indicatorId || undefined })}>‹ คลังข้อสอบ</a></p>
          <h1>{item ? <>ข้อ {item.itemCode} <small className="sub">เวอร์ชัน {item.currentVersion}</small></> : 'เพิ่มข้อใหม่'}</h1>
          {item && (
            <div className="head-meta">
              <StatusChip status={item.status} />
              {item.isSample && <span className="chip">ข้อหุ่น</span>}
              <span className="sub" style={{ margin: 0 }}>
                ความยากปัจจุบัน {ref.difficulties.find((d) => d.id === item.currentDifficulty)?.nameTh}
                {' · '}n {item.n}{item.p !== null ? ` · p ${item.p.toFixed(2)}` : ''}{item.r !== null ? ` · r ${item.r.toFixed(2)}` : ''}
              </span>
            </div>
          )}
        </div>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      {error && <div className="error box" role="alert">{error}</div>}

      {item && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-pressed={tab === 'edit'} onClick={() => setTab('edit')}>แก้ไข</button>
          <button role="tab" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>ประวัติ ({item.versions.length} เวอร์ชัน)</button>
        </div>
      )}

      {tab === 'history' && item && (
        <div className="editor-grid">
          <section className="card">
            <h2>เวอร์ชัน</h2>
            <ul className="plain">
              {item.versions.slice().reverse().map((v) => (
                <li key={v.version}>
                  <button className="link" onClick={() => setViewVersion(viewVersion === v.version ? null : v.version)}>
                    v{v.version}{v.version === item.currentVersion ? ' (ปัจจุบัน)' : ''}
                  </button>{' '}
                  <span className="sub" style={{ margin: 0 }}>{fmtDate(v.createdAt)}{v.changeNote ? ` · ${v.changeNote}` : ''}</span>
                </li>
              ))}
            </ul>
            {shownVersion && <ItemPreview content={shownVersion.content} answer={shownVersion.answer} note={figureNote} />}
          </section>
          <section className="card">
            <h2>ประวัติการเปลี่ยนแปลง</h2>
            <ul className="timeline" data-testid="events">
              {item.events.slice().reverse().map((e, i) => (
                <li key={i}><strong>{EVENT_TH[e.type] ?? e.type}</strong> {describeEvent(e, ref)}
                  <div className="sub" style={{ margin: 0 }}>{fmtDate(e.at)}</div></li>
              ))}
            </ul>
            <p className="sub">ใช้ในชุดข้อสอบแล้ว {item.usedInExams} ชุด</p>
          </section>
        </div>
      )}

      {tab === 'edit' && (
        <div className="editor-grid">
          <div className="editor-form">
            <section className="card">
              <h2>ข้อมูลกำกับ</h2>
              <div className="field-grid">
                <label><span>ชั้น</span>
                  <select aria-label="ชั้น" value={gradeSel} onChange={(e) => { setGradeSel(e.target.value); upd((d) => { d.indicatorId = ''; }); }}>
                    {ref.grades.map((g) => <option key={g.id} value={g.id}>{g.shortTh}</option>)}
                  </select>
                </label>
                <label className="wide"><span>ตัวชี้วัด</span>
                  <select aria-label="ตัวชี้วัด" value={draft.indicatorId} onChange={(e) => upd((d) => { d.indicatorId = e.target.value; })}>
                    <option value="">— เลือกตัวชี้วัด —</option>
                    {inds.map((i) => <option key={i.id} value={i.id}>{i.code} {i.text.slice(0, 60)}{i.text.length > 60 ? '…' : ''}</option>)}
                  </select>
                </label>
                <label><span>ระดับการคิด</span>
                  <select aria-label="ระดับการคิด" value={draft.cognitiveLevel} onChange={(e) => upd((d) => { d.cognitiveLevel = Number(e.target.value); })}>
                    {ref.cognitives.map((c) => <option key={c.id} value={c.id}>{c.nameTh}</option>)}
                  </select>
                </label>
                <label><span>ความยากคาดการณ์</span>
                  <select aria-label="ความยากคาดการณ์" value={draft.estDifficulty} onChange={(e) => upd((d) => { d.estDifficulty = Number(e.target.value); })}>
                    {ref.difficulties.map((d) => <option key={d.id} value={d.id}>{d.nameTh}</option>)}
                  </select>
                </label>
                <label><span>หัวข้อย่อย</span>
                  <input type="text" aria-label="หัวข้อย่อย" value={draft.subtopic ?? ''} onChange={(e) => upd((d) => { d.subtopic = e.target.value || null; })} />
                </label>
                <label><span>ป้าย (คั่นด้วยจุลภาค)</span>
                  <input type="text" aria-label="ป้าย" value={tagsText} onChange={(e) => {
                    setTagsText(e.target.value);
                    upd((d) => { d.tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); });
                  }} />
                </label>
                <label className="check wide">
                  <input type="checkbox" checked={draft.noShuffle} onChange={(e) => upd((d) => { d.noShuffle = e.target.checked; })} />
                  ห้ามสลับตัวเลือก (เช่น ตัวเลือกเรียงตามค่า หรืออ้างถึงตัวเลือกอื่น)
                </label>
              </div>
              {ind?.assessmentNote && <p className="ind-note">⚠ {ind.assessmentNote}</p>}
            </section>

            <section className="card">
              <h2>โจทย์</h2>
              <textarea rows={4} aria-label="โจทย์" value={draft.content.stem} onChange={(e) => upd((d) => { d.content.stem = e.target.value; })} />
            </section>

            <section className="card">
              <h2>รูปประกอบ</h2>
              <FigureEditor value={draft.content.figure} onChange={(f) => upd((d) => { d.content.figure = f; })} />
            </section>

            <section className="card">
              <h2>ตัวเลือกและเฉลย</h2>
              <p className="sub">เลือกวงกลมหน้าตัวเลือกที่ถูก แล้วเขียนเหตุผลของตัวลวงแต่ละตัว (เด็กที่เลือกข้อนี้เข้าใจผิดเรื่องอะไร)</p>
              {draft.content.options.map((o, i) => (
                <div key={i} className={`option-edit ${draft.answer.choice === i + 1 ? 'is-answer' : ''}`}>
                  <label className="answer-pick">
                    <input type="radio" name="answer" aria-label={`เฉลยตัวเลือก ${i + 1}`} checked={draft.answer.choice === i + 1}
                      onChange={() => upd((d) => { d.answer.choice = i + 1; })} />
                    {i + 1})
                  </label>
                  <div className="option-fields">
                    <input type="text" aria-label={`ตัวเลือก ${i + 1}`} value={o} onChange={(e) => setOption(i, e.target.value)} />
                    {draft.answer.choice !== i + 1 && (
                      <input type="text" className="rationale" aria-label={`เหตุผลตัวลวง ${i + 1}`} placeholder="เหตุผลของตัวลวง"
                        value={draft.content.distractor_rationale[i] ?? ''} onChange={(e) => setRationale(i, e.target.value)} />
                    )}
                  </div>
                </div>
              ))}
              <label className="block"><span>นิพจน์คำนวณเฉลยซ้ำ (ไม่บังคับ{requireCheck ? ' — ตั้งค่าบังคับไว้' : ''})</span>
                <input type="text" aria-label="นิพจน์คำนวณเฉลย" placeholder="เช่น 3/4 + 1/8 หรือ (12 × 5) ÷ 2"
                  value={draft.content.check ?? ''} onChange={(e) => upd((d) => { d.content.check = e.target.value || null; })} />
              </label>
              {checkResult && (
                <small className={checkResult.ok ? 'hint-line' : 'warn-text'} data-testid="check-result">
                  {checkResult.ok ? `ผลคำนวณ = ${checkResult.text}` : checkResult.text}
                </small>
              )}
              <label className="block"><span>วิธีคิด / คำอธิบายเฉลย</span>
                <textarea rows={3} aria-label="วิธีคิด" value={draft.content.explanation} onChange={(e) => upd((d) => { d.content.explanation = e.target.value; })} />
              </label>
            </section>
          </div>

          <aside className="editor-side">
            <section className="card">
              <h2>ตัวอย่าง</h2>
              <ItemPreview content={draft.content} answer={draft.answer} note={figureNote} />
            </section>

            <section className="card" data-testid="qa-panel">
              <h2>ตรวจคุณภาพอัตโนมัติ</h2>
              {qa.passed
                ? <p className="ok-text" data-testid="qa-status">✓ ผ่าน{qa.warnings.length ? ` (มีข้อสังเกต ${qa.warnings.length})` : ''}</p>
                : <p className="warn-text" data-testid="qa-status">✗ ยังไม่ผ่าน ({qa.errors.length} รายการต้องแก้)</p>}
              <ul className="qa-list">
                {qa.errors.map((e, i) => <li key={`e${i}`} className="qa-error">{e.message}</li>)}
                {qa.warnings.map((w, i) => <li key={`w${i}`} className="qa-warn">{w.message}</li>)}
              </ul>
            </section>

            <section className="card">
              <h2>บันทึก</h2>
              {item && edit && (
                <fieldset className="modes" aria-label="วิธีบันทึก">
                  <label className={!edit.minorAllowed ? 'disabled' : ''}>
                    <input type="radio" name="mode" checked={mode === 'minor'} disabled={!edit.minorAllowed} onChange={() => setUserMode('minor')} />
                    แก้คำผิด/รูปแบบ — เวอร์ชันเดิม (สถิติคงเดิม)
                  </label>
                  <label>
                    <input type="radio" name="mode" checked={mode === 'major'} onChange={() => setUserMode('major')} />
                    แก้เนื้อหา — ขึ้นเวอร์ชัน {item.currentVersion + 1} (เริ่มนับสถิติใหม่ และกลับเป็นร่างให้ตรวจใหม่)
                  </label>
                  {!edit.minorAllowed && <small className="hint-line" data-testid="major-reasons">ต้องขึ้นเวอร์ชันใหม่เพราะ: {edit.majorReasons.join(', ')}</small>}
                </fieldset>
              )}
              {item && (
                <label className="block"><span>บันทึกการแก้ไข (ไม่บังคับ)</span>
                  <input type="text" aria-label="บันทึกการแก้ไข" value={note} onChange={(e) => setNote(e.target.value)} placeholder="แก้อะไร เพราะอะไร" />
                </label>
              )}
              <div className="actions">
                <button className="btn" disabled={busy || (!!item && !dirty)} onClick={() => save(false)}>
                  {busy ? 'กำลังบันทึก…' : item ? 'บันทึก' : 'บันทึกเป็นร่าง'}
                </button>
                <button className="btn ghost" disabled={busy || !qa.passed || (!!item && !dirty)} onClick={() => save(true)}
                  title={qa.passed ? '' : 'ต้องผ่านการตรวจอัตโนมัติก่อน'}>
                  บันทึกและยืนยันตรวจแล้ว
                </button>
              </div>
              {item && !dirty && <small className="hint-line">ยังไม่มีการแก้ไข</small>}
            </section>

            {item && (
              <section className="card">
                <h2>สถานะ</h2>
                <p className="sub">ข้อจะถูกสุ่มเข้าชุดข้อสอบได้เมื่อเป็น "ตรวจแล้ว" หรือ "ใช้งาน"</p>
                <div className="actions wrap">
                  {statusTargets.filter((s) => s !== item.status).map((s) => {
                    const blocked = item.isSample ? null : statusChangeBlocked(s, savedQaPassed);
                    return (
                      <button key={s} className="btn ghost" disabled={busy || !!blocked || dirty} title={blocked ?? (dirty ? 'บันทึกการแก้ไขก่อน' : '')}
                        onClick={() => changeStatus(s)}>ตั้งเป็น "{STATUS_TH[s]}"</button>
                    );
                  })}
                </div>
                {item.status === 'draft' && item.usedInExams === 0 && item.n === 0 && (
                  !confirmDelete
                    ? <button className="btn danger-ghost" onClick={() => setConfirmDelete(true)}>ลบข้อนี้…</button>
                    : (
                      <div className="confirm" role="alertdialog" aria-label="ยืนยันการลบ">
                        <p>ลบข้อ {item.itemCode} ถาวร? (ย้อนกลับไม่ได้)</p>
                        <div className="actions">
                          <button className="btn danger" disabled={busy} onClick={remove}>ยืนยันลบ</button>
                          <button className="btn ghost" onClick={() => setConfirmDelete(false)}>ยกเลิก</button>
                        </div>
                      </div>
                    )
                )}
              </section>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
