// ตั้งค่าห้อง (One Stop เฟส 2): ข้อมูลห้อง · ช่องคะแนนเรียงตามแผนการสอน (ลาก/ปุ่มขึ้นลง) · คะแนนเต็ม · วิธีคิดคะแนน
// ทุกการแก้บันทึกทันที (คะแนนดิบเก็บแยกจากคะแนนเต็ม — แก้เมื่อไรก็คำนวณใหม่ ไม่ต้องกรอกซ้ำ)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import type { ClassroomDetail, GbColumn, GbSettings } from '../../core/types';
import type { Route } from '../../ui/router';
import { navigate } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import {
  ABSENT_TH, AGGREGATION_TH, RETAKE_TH, ROUNDING_TH, effectiveSettings, fmtScore, gradebookDefaults, moveItem, parseMaxScore,
  scoreTotals, splitIndicatorCode, splitTotal,
} from './plan';

type Status = { kind: 'ok' | 'error'; text: string } | null;

export function ClassroomSettingsPage({ id, route }: { id: string; route: Route }) {
  const { data: ref } = useRefData();
  const d = useMemo(() => gradebookDefaults(ref?.settings), [ref]);
  const [room, setRoom] = useState<ClassroomDetail | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>(route.params.get('created') ? { kind: 'ok', text: 'สร้างห้องเรียนแล้ว' } : null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => repo.getClassroom(id).then(setRoom, (e) => setStatus({ kind: 'error', text: (e as Error).message })), [id]);
  useEffect(() => { reload(); }, [reload]);

  /** ทำงาน 1 อย่าง แล้วโหลดห้องใหม่ — ผิดพลาด = แจ้งและโหลดค่าจริงจากฐานข้อมูลกลับมา */
  async function act(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    try { await fn(); setStatus({ kind: 'ok', text: okText }); }
    catch (e) { setStatus({ kind: 'error', text: (e as Error).message }); }
    finally { await reload(); setBusy(false); }
  }

  if (room === undefined) return <p className="sub">กำลังโหลด…</p>;
  if (room === null) return <div className="card">ไม่พบห้องเรียน · <a href="#/classes">กลับไปรายการห้อง</a></div>;

  const eff = effectiveSettings(room.settings, d);
  const closed = room.status !== 'open';
  const grade = ref?.grades.find((g) => g.id === room.gradeId);
  const planCols = room.columns.filter((c) => c.kind !== 'final' && (c.kind !== 'other' || eff.show_other_columns));
  const hiddenOther = room.columns.filter((c) => c.kind === 'other').length - planCols.filter((c) => c.kind === 'other').length;
  const finalCol = room.columns.find((c) => c.kind === 'final')!;
  const totals = scoreTotals(room.columns, eff.show_other_columns);
  const indCount = room.columns.filter((c) => c.kind === 'indicator').length;

  function reorder(from: number, to: number) {
    if (!room || from === to) return;
    const all = room.columns.filter((c) => c.kind !== 'final');   // ส่งครบทุกช่อง (รวมช่องอื่นที่ซ่อน)
    const visibleIds = planCols.map((c) => c.id);
    const moved = moveItem(visibleIds, from, to);
    const hidden = all.filter((c) => !visibleIds.includes(c.id)).map((c) => c.id);
    const ids = [...moved, ...hidden];
    // แสดงลำดับใหม่ทันที แล้วบันทึก
    const byId = new Map(room.columns.map((c) => [c.id, c]));
    setRoom({ ...room, columns: [...ids.map((x, k) => ({ ...byId.get(x)!, sort: k + 1 })), finalCol] });
    act(() => repo.reorderColumns(room.id, ids), 'บันทึกลำดับแล้ว');
  }

  return (
    <>
      <p className="crumb"><a href="#/classes">← ห้องเรียน</a></p>
      <div className="page-head">
        <div>
          <h1 data-testid="class-title">{room.name} <small className="sub">ภาคเรียนที่ {room.term}/{room.academicYear}</small></h1>
          <div className="head-meta">
            <span className="chip">{grade?.shortTh ?? room.gradeId}</span>
            <span className="chip">นักเรียน {room.studentCount} คน</span>
            <span className={`chip ${closed ? 'ex-closed' : 'ex-open'}`}>{closed ? 'ปิดเทอมแล้ว' : 'เปิดอยู่'}</span>
          </div>
        </div>
      </div>
      {status && <div className={status.kind === 'ok' ? 'notice' : 'error box'} role={status.kind === 'error' ? 'alert' : 'status'} data-testid="class-status">{status.text}</div>}
      {closed && <div className="banner">ห้องนี้ปิดเทอมแล้ว — ดูได้อย่างเดียว แก้ไขไม่ได้</div>}

      <fieldset className="plain" disabled={closed}>
        <RoomInfo room={room} maxStudents={d.maxStudents} busy={busy}
          onSave={(name, n) => act(() => repo.updateClassroom(room.id, { name, studentCount: n }), 'บันทึกข้อมูลห้องแล้ว')} />

        <section className="card builder-step">
          <h2>ช่องคะแนน</h2>
          <p className="sub" style={{ marginBottom: 10 }}>เรียงตามแผนการสอน — ลากหรือกดลูกศรเพื่อสลับ</p>
          <div className="score-total" data-testid="score-total">
            <span>ตัวชี้วัด <strong>{fmtScore(totals.collect)}</strong></span>
            <span>+ ปลายภาค <strong>{fmtScore(totals.final)}</strong></span>
            <span>= รวม <strong data-testid="score-grand">{fmtScore(totals.total)}</strong></span>
            {totals.unset > 0 && <span className="chip weak" data-testid="unset-count">ยังไม่ตั้งคะแนน {totals.unset} ช่อง</span>}
            <span className="hint-line">ไม่บังคับให้รวมเป็น 100 · ช่องว่าง = ยังไม่ตั้งคะแนนเต็ม</span>
          </div>

          {planCols.length === 0 && <p className="sub" data-testid="no-columns">ยังไม่มีตัวชี้วัด — เพิ่มด้านล่าง สอนตัวไหนเพิ่มตัวนั้นได้</p>}
          <ol className="col-list" data-testid="columns">
            {planCols.map((c, k) => (
              <ColumnRow key={c.id} col={c} index={k} count={planCols.length} busy={busy}
                code={c.indicatorId ? ref?.indicatorById.get(c.indicatorId)?.code ?? c.indicatorId : null}
                text={c.indicatorId ? ref?.indicatorById.get(c.indicatorId)?.text ?? '' : ''}
                onMove={reorder}
                onMax={(v) => act(() => repo.updateColumn(c.id, v), 'บันทึกคะแนนเต็มแล้ว')}
                onLabel={(v) => act(() => repo.updateColumn(c.id, c.maxScore, v), 'บันทึกชื่อช่องแล้ว')}
                onDelete={() => act(() => repo.deleteColumn(c.id), 'ลบช่องแล้ว')} />
            ))}
          </ol>
          <div className="col-row final" data-testid="final-row">
            <span className="col-no">สอบ</span>
            <div className="col-body"><span className="ind-code">สอบปลายภาค</span><span className="ind-text">คะแนนรวมช่องเดียว ไม่แยกตัวชี้วัด</span></div>
            <MaxInput value={finalCol.maxScore} label="คะแนนเต็มสอบปลายภาค" allowEmpty={false}
              onCommit={(v) => act(() => repo.updateColumn(finalCol.id, v ?? 0), 'บันทึกคะแนนปลายภาคแล้ว')} />
          </div>
          {hiddenOther > 0 && <p className="hint">มีช่องคะแนนอื่นที่ซ่อนอยู่ {hiddenOther} ช่อง (เปิดได้ที่ "วิธีคิดคะแนน")</p>}

          {indCount > 0 && <SplitTool count={indCount} initial={d.indicatorTotal} busy={busy}
            onApply={(total) => {
              const cols = room.columns.filter((c) => c.kind === 'indicator').sort((a, b) => a.sort - b.sort);
              const parts = splitTotal(total, cols.length);
              return act(async () => { for (let k = 0; k < cols.length; k++) await repo.updateColumn(cols[k].id, parts[k]); },
                `แบ่ง ${fmtScore(total)} คะแนนให้ ${cols.length} ตัวชี้วัดแล้ว`);
            }} />}

          <AddIndicator room={room} busy={busy}
            onAdd={(indId, max) => act(() => repo.addColumn(room.id, 'indicator', indId, null, max), 'เพิ่มตัวชี้วัดแล้ว')} />
          {eff.show_other_columns && <AddOther busy={busy}
            onAdd={(label, max) => act(() => repo.addColumn(room.id, 'other', null, label, max), 'เพิ่มช่องคะแนนอื่นแล้ว')} />}
        </section>

        <ScoringSettings room={room} eff={eff} busy={busy}
          onChange={(patch) => act(() => repo.updateClassroom(room.id, { settings: patch }), 'บันทึกวิธีคิดคะแนนแล้ว')} />

        <DeleteRoom busy={busy} onDelete={async () => {
          setBusy(true);
          try { await repo.deleteClassroom(room.id); navigate('/classes', undefined, true); }
          catch (e) { setStatus({ kind: 'error', text: (e as Error).message }); setBusy(false); }
        }} />
      </fieldset>
    </>
  );
}

function RoomInfo({ room, maxStudents, busy, onSave }: { room: ClassroomDetail; maxStudents: number; busy: boolean;
  onSave: (name: string, n: number) => void }) {
  const [name, setName] = useState(room.name);
  const [n, setN] = useState(String(room.studentCount));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setName(room.name); setN(String(room.studentCount)); }, [room.name, room.studentCount]);
  const dirty = name !== room.name || n !== String(room.studentCount);
  function save() {
    const v = Number(n);
    if (!name.trim()) return setErr('ใส่ชื่อห้อง');
    if (!Number.isInteger(v) || v < 1 || v > maxStudents) return setErr(`จำนวนนักเรียนต้องเป็น 1–${maxStudents}`);
    setErr(null);
    onSave(name.trim(), v);
  }
  return (
    <section className="card builder-step">
      <h2>ข้อมูลห้อง</h2>
      <div className="field-grid builder-fields">
        <label>ชื่อห้อง<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <label>จำนวนนักเรียน (เลขที่ 1–N)
          <input type="number" inputMode="numeric" min={1} max={maxStudents} value={n} onChange={(e) => setN(e.target.value)} />
        </label>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="actions"><button className="btn" onClick={save} disabled={busy || !dirty}>บันทึกข้อมูลห้อง</button></div>
    </section>
  );
}

/** ช่องกรอกคะแนนเต็ม — บันทึกเมื่อออกจากช่องหรือกด Enter (ว่าง = ยังไม่ตั้ง) */
function MaxInput({ value, label, allowEmpty = true, onCommit }: { value: number | null; label: string; allowEmpty?: boolean;
  onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : fmtScore(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(value === null ? '' : fmtScore(value)); setErr(null); }, [value]);
  function commit() {
    const p = parseMaxScore(text);
    if (!p.ok) return setErr(p.error);
    if (p.value === null && !allowEmpty) return setErr('ใส่คะแนนเต็ม (0 ได้ถ้าไม่ใช้)');
    setErr(null);
    if (p.value !== value) onCommit(p.value);
  }
  return (
    <span className="max-input">
      <input aria-label={label} inputMode="decimal" placeholder="–" value={text} aria-invalid={!!err}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="unit">คะแนน</span>
      {err && <span className="error small" role="alert">{err}</span>}
    </span>
  );
}

function ColumnRow({ col, index, count, code, text, busy, onMove, onMax, onLabel, onDelete }: {
  col: GbColumn; index: number; count: number; code: string | null; text: string; busy: boolean;
  onMove: (from: number, to: number) => void; onMax: (v: number | null) => void; onLabel: (v: string) => void; onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [over, setOver] = useState(false);
  const c = code ? splitIndicatorCode(code) : null;
  const name = c ? `${c.standard} ${c.indicator}` : col.label ?? '';
  return (
    <li className={`col-row${over ? ' over' : ''}`} data-testid="column-row" data-column-id={col.id}
      draggable={!busy}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const from = Number(e.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) onMove(from, index); }}>
      <span className="col-no" aria-hidden="true"><span className="grip">⠿</span>{index + 1}</span>
      <div className="col-body">
        {c ? <span className="ind-code" data-testid="column-code">{name}</span>
          : <LabelInput value={col.label ?? ''} onCommit={onLabel} />}
        {c ? <span className="ind-text">{text}</span> : <span className="ind-text">ช่องคะแนนอื่น</span>}
      </div>
      <MaxInput value={col.maxScore} label={`คะแนนเต็ม ${name}`} onCommit={onMax} />
      <span className="col-tools">
        <button type="button" className="btn ghost icon" aria-label={`เลื่อน ${name} ขึ้น`} disabled={busy || index === 0} onClick={() => onMove(index, index - 1)}>↑</button>
        <button type="button" className="btn ghost icon" aria-label={`เลื่อน ${name} ลง`} disabled={busy || index === count - 1} onClick={() => onMove(index, index + 1)}>↓</button>
        {!confirm && <button type="button" className="btn ghost icon" aria-label={`ลบ ${name}`} disabled={busy} onClick={() => setConfirm(true)}>✕</button>}
        {confirm && (
          <span className="confirm-inline">
            <button type="button" className="btn danger" onClick={() => { setConfirm(false); onDelete(); }}>ยืนยันลบ</button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>ไม่ลบ</button>
          </span>
        )}
      </span>
      {confirm && <span className="hint-line col-warn">ลบช่องนี้: คะแนนจากการสอบไม่หาย (เพิ่มตัวชี้วัดกลับมาคะแนนกลับมาด้วย) แต่คะแนนที่ครูปรับในช่องนี้จะหาย</span>}
    </li>
  );
}

function LabelInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <input className="label-input" aria-label="ชื่อช่องคะแนน" value={text} maxLength={60} onChange={(e) => setText(e.target.value)}
    onBlur={() => { if (text.trim() && text.trim() !== value) onCommit(text.trim()); else setText(value); }} />;
}

function SplitTool({ count, initial, busy, onApply }: { count: number; initial: number; busy: boolean; onApply: (total: number) => void }) {
  const [text, setText] = useState(String(initial));
  const [err, setErr] = useState<string | null>(null);
  const p = parseMaxScore(text);
  const preview = p.ok && p.value !== null ? splitTotal(p.value, count) : null;
  return (
    <div className="tool-row" data-testid="split-tool">
      <label className="inline-field">แบ่งคะแนนรวม
        <input aria-label="คะแนนรวมที่จะแบ่ง" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />
        ให้ {count} ตัวชี้วัดเท่า ๆ กัน
      </label>
      <button type="button" className="btn ghost" disabled={busy || !preview} onClick={() => {
        if (!p.ok || p.value === null) return setErr('ใส่คะแนนรวม');
        setErr(null); onApply(p.value);
      }}>แบ่งคะแนน</button>
      {preview && <span className="hint-line">จะได้ {[...new Set(preview)].sort((a, b) => b - a).join(' / ')} คะแนน (ตัวแรก ๆ ได้เศษก่อน) — ทับคะแนนเดิมของทุกตัวชี้วัด</span>}
      {err && <span className="error small">{err}</span>}
    </div>
  );
}

function AddIndicator({ room, busy, onAdd }: { room: ClassroomDetail; busy: boolean; onAdd: (indicatorId: string, max: number | null) => void }) {
  const { data: ref } = useRefData();
  const [indId, setIndId] = useState('');
  const [max, setMax] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const have = new Set(room.columns.map((c) => c.indicatorId).filter(Boolean));
  const avail = (ref?.indicators ?? []).filter((i) => !have.has(i.id));
  const own = avail.filter((i) => i.gradeId === room.gradeId), other = avail.filter((i) => i.gradeId !== room.gradeId);
  function add() {
    const p = parseMaxScore(max);
    if (!indId) return setErr('เลือกตัวชี้วัด');
    if (!p.ok) return setErr(p.error);
    setErr(null); onAdd(indId, p.value); setIndId(''); setMax('');
  }
  return (
    <div className="tool-row add-row" data-testid="add-indicator">
      <label className="inline-field grow">เพิ่มตัวชี้วัด
        <select aria-label="ตัวชี้วัดที่จะเพิ่ม" value={indId} onChange={(e) => setIndId(e.target.value)}>
          <option value="">— เลือกตัวชี้วัด —</option>
          {own.length > 0 && <optgroup label="ชั้นของห้องนี้">{own.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.text}</option>)}</optgroup>}
          {other.length > 0 && <optgroup label="ชั้นอื่น">{other.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.text}</option>)}</optgroup>}
        </select>
      </label>
      <label className="inline-field">คะแนนเต็ม
        <input aria-label="คะแนนเต็มของตัวชี้วัดที่จะเพิ่ม" inputMode="decimal" placeholder="ว่างได้" value={max} onChange={(e) => setMax(e.target.value)} />
      </label>
      <button type="button" className="btn" disabled={busy || avail.length === 0} onClick={add}>+ เพิ่ม</button>
      {err && <span className="error small" role="alert">{err}</span>}
    </div>
  );
}

function AddOther({ busy, onAdd }: { busy: boolean; onAdd: (label: string, max: number | null) => void }) {
  const [label, setLabel] = useState('');
  const [max, setMax] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="tool-row add-row" data-testid="add-other">
      <label className="inline-field grow">เพิ่มช่องคะแนนอื่น
        <input aria-label="ชื่อช่องคะแนนอื่น" placeholder="เช่น ส่งงาน, เข้าเรียน" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="inline-field">คะแนนเต็ม
        <input aria-label="คะแนนเต็มของช่องอื่น" inputMode="decimal" placeholder="ว่างได้" value={max} onChange={(e) => setMax(e.target.value)} />
      </label>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => {
        const p = parseMaxScore(max);
        if (!label.trim()) return setErr('ใส่ชื่อช่อง');
        if (!p.ok) return setErr(p.error);
        setErr(null); onAdd(label.trim(), p.value); setLabel(''); setMax('');
      }}>+ เพิ่มช่อง</button>
      {err && <span className="error small" role="alert">{err}</span>}
    </div>
  );
}

function ScoringSettings({ room, eff, busy, onChange }: { room: ClassroomDetail; eff: Required<GbSettings>; busy: boolean;
  onChange: (patch: GbSettings) => void }) {
  const row = <K extends keyof GbSettings>(key: K, label: string, opts: Record<string, string>) => (
    <label>{label}
      <select aria-label={label} value={String(eff[key])} disabled={busy}
        onChange={(e) => onChange({ [key]: (key === 'show_other_columns' ? e.target.value === 'true' : e.target.value) } as GbSettings)}>
        {Object.entries(opts).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      {room.settings[key] === undefined && <span className="hint-line">ค่าเริ่มต้นของระบบ</span>}
    </label>
  );
  return (
    <section className="card builder-step" data-testid="scoring-settings">
      <h2>วิธีคิดคะแนน</h2>
      <div className="field-grid builder-fields">
        {row('rounding', 'การปัดคะแนน', ROUNDING_TH)}
        {row('aggregation', 'ตัวชี้วัดที่สอบหลายครั้ง', AGGREGATION_TH)}
        {row('retake_policy', 'สอบซ่อม/สอบซ้ำ นับครั้งไหน', RETAKE_TH)}
        {row('absent_policy', 'ขาดสอบ', ABSENT_TH)}
        {row('show_other_columns', 'ช่องคะแนนอื่น (เข้าเรียน/ส่งงาน)', { false: 'ซ่อน', true: 'แสดง' })}
      </div>
      <p className="hint">เปลี่ยนเมื่อไรก็ได้ ระบบคำนวณคะแนนใหม่ทันที (คะแนนดิบจากการสอบไม่เปลี่ยน)</p>
    </section>
  );
}

function DeleteRoom({ busy, onDelete }: { busy: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button type="button" className="btn danger-ghost" disabled={busy} onClick={() => setConfirm(true)}>ลบห้องเรียนนี้</button>;
  return (
    <div className="confirm" role="alertdialog" aria-label="ยืนยันลบห้องเรียน">
      <p>ลบห้องนี้และช่องคะแนนทั้งหมด? ย้อนกลับไม่ได้ (ห้องที่มีคะแนนจากการสอบแล้วต้องปิดเทอมก่อนจึงลบได้)</p>
      <div className="actions">
        <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>ยืนยันลบห้อง</button>
        <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>ไม่ลบ</button>
      </div>
    </div>
  );
}
