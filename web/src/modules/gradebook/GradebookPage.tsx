// สมุดคะแนนของห้อง (One Stop เฟส 4): คะแนนสะสมรายเลขที่ × ตัวชี้วัด แปลงตามคะแนนเต็ม · สอบซ่อม · ปรับให้ผ่าน · ตัวชี้วัดที่ยังไม่เก็บ
// หน้านี้แสดงผลจาก repo.getGradebook (= gb_sheet) เท่านั้น ไม่คิดคะแนนเอง — ทุกการแก้บันทึกทันทีแล้วโหลดสมุดใหม่
import { useCallback, useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import type { GbSheet, GbSheetCell, GbSheetColumn } from '../../core/types';
import type { Route } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { ABSENT_TH, AGGREGATION_TH, RETAKE_TH, ROUNDING_TH, fmtScore } from './plan';
import {
  belowPass, columnHead, columnStats, parseAdjust, passScore, seatDetail, uncollectedColumns,
} from './sheet';
import './book.css';

type View = 'value' | 'real' | 'raw';
const VIEW_TH: Record<View, string> = { value: 'คะแนนลงชีท', real: 'คะแนนจริง', raw: 'คะแนนดิบ (ถูก/เต็ม)' };
type Status = { kind: 'ok' | 'error'; text: string } | null;
type Sel = { kind: 'cell'; columnId: number; seatNo: number } | { kind: 'column'; columnId: number } | null;

export function GradebookPage({ id, route }: { id: string; route: Route }) {
  const { data: ref } = useRefData();
  const passRatio = Number(ref?.settings['report.indicator_pass_ratio'] ?? 0.5);
  const [sheet, setSheet] = useState<GbSheet | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>(() => (['value', 'real', 'raw'].includes(route.params.get('view') ?? '') ? route.params.get('view') as View : 'value'));
  const [sel, setSel] = useState<Sel>(null);

  const reload = useCallback(() => repo.getGradebook(id).then(setSheet, (e) => {
    const msg = (e as Error).message;
    if (/ไม่พบห้องเรียน/.test(msg)) setSheet(null); else setStatus({ kind: 'error', text: msg });
  }), [id]);
  useEffect(() => { reload(); }, [reload]);

  async function act(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    try { await fn(); setStatus({ kind: 'ok', text: okText }); }
    catch (e) { setStatus({ kind: 'error', text: (e as Error).message }); }
    finally { await reload(); setBusy(false); }
  }

  const visible = useMemo(() => {
    if (!sheet) return [] as Array<{ col: GbSheetColumn; index: number }>;
    return sheet.columns.map((col, index) => ({ col, index }))
      .filter(({ col }) => col.kind !== 'other' || sheet.classroom.settings.show_other_columns);
  }, [sheet]);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  if (sheet === undefined) return status ? <div className="error box" role="alert">{status.text}</div> : <p className="sub">กำลังโหลด…</p>;
  if (sheet === null) return <div className="card">ไม่พบห้องเรียน · <a href="#/classes">กลับไปรายการห้อง</a></div>;

  const c = sheet.classroom;
  const s = c.settings;
  const closed = c.status !== 'open';
  const grade = ref?.grades.find((g) => g.id === c.gradeId);
  const plan = visible.filter(({ col }) => col.kind !== 'final');
  const fin = visible.find(({ col }) => col.kind === 'final');
  const uncollected = uncollectedColumns(sheet);
  const scoredExams = sheet.exams.filter((e) => e.purpose !== 'practice');
  const absentCells = sheet.rows.reduce((n, r) => n + r.cells.filter((x) => x.missing.length > 0).length, 0);
  const indName = (indId: string) => ref?.indicatorById.get(indId)?.code ?? indId;
  const collectMaxVisible = plan.reduce((a, { col }) => a + (col.maxScore ?? 0), 0);

  function cellText(cell: GbSheetCell) {
    if (view === 'raw') return cell.rawTotal ? `${fmtScore(cell.rawCorrect)}/${fmtScore(cell.rawTotal)}` : null;
    const v = view === 'real' ? cell.real : cell.value;
    return v === null ? null : fmtScore(v);
  }

  return (
    <>
      <p className="crumb"><a href="#/classes">← ห้องเรียน</a> · <a href={`#/classes/${c.id}`}>ตั้งค่าห้อง {c.name}</a></p>
      <div className="page-head">
        <div>
          <h1 data-testid="book-title">สมุดคะแนน {c.name} <small className="sub">ภาคเรียนที่ {c.term}/{c.academicYear}</small></h1>
          <div className="head-meta">
            <span className="chip">{grade?.shortTh ?? c.gradeId}</span>
            <span className="chip">นักเรียน {c.studentCount} คน</span>
            <span className="chip">ชุดเก็บคะแนน/ปลายภาค {scoredExams.length} ชุด</span>
            <span className={`chip ${closed ? 'ex-closed' : 'ex-open'}`}>{closed ? 'ปิดเทอมแล้ว' : 'เปิดอยู่'}</span>
          </div>
          <p className="book-policy" data-testid="book-policy">
            <span>รวมคะแนน: {AGGREGATION_TH[s.aggregation]}</span>
            <span>สอบซ่อม: {RETAKE_TH[s.retake_policy]}</span>
            <span>ขาดสอบ: {ABSENT_TH[s.absent_policy]}</span>
            <span>ปัด: {ROUNDING_TH[s.rounding]}</span>
            {!closed && <a href={`#/classes/${c.id}`}>เปลี่ยนวิธีคิด</a>}
          </p>
        </div>
        {!closed && <a className="btn ghost" href={`#/exams/new?classroom=${encodeURIComponent(c.id)}`}>+ สร้างชุดข้อสอบ</a>}
      </div>

      {status && <div className={status.kind === 'ok' ? 'notice' : 'error box'} role={status.kind === 'error' ? 'alert' : 'status'} data-testid="book-status">{status.text}</div>}
      {closed && <div className="banner">ห้องนี้ปิดเทอมแล้ว — ดูได้อย่างเดียว</div>}

      <div className="book-alerts" data-testid="book-alerts">
        {scoredExams.length === 0 && !closed && (
          <div className="alert info" data-testid="alert-no-exams">ยังไม่มีชุดเก็บคะแนน/ปลายภาคของห้องนี้ — สร้างชุดข้อสอบแล้วตรวจ คะแนนจะลงสมุดเอง
            <a className="btn" href={`#/exams/new?classroom=${encodeURIComponent(c.id)}`}>สร้างชุดข้อสอบ</a></div>
        )}
        {sheet.unplannedIndicators.map((ind) => (
          <div className="alert" key={ind} data-testid="alert-unplanned">
            <span>มีคะแนน <strong>{indName(ind)}</strong> จากการสอบแล้ว แต่ห้องยังไม่มีช่องตัวชี้วัดนี้ (คะแนนเก็บไว้ ยังไม่ลงสมุด)</span>
            {!closed && <button className="btn" disabled={busy} onClick={() => act(() => repo.addColumn(c.id, 'indicator', ind, null, null),
              `เพิ่มช่อง ${indName(ind)} แล้ว — ตั้งคะแนนเต็มที่หน้าตั้งค่าห้อง`)}>เพิ่มเป็นช่อง</button>}
          </div>
        ))}
        {sheet.totals.unsetColumns > 0 && (
          <div className="alert" data-testid="alert-unset">ยังไม่ตั้งคะแนนเต็ม {sheet.totals.unsetColumns} ช่อง — ช่องนั้นยังไม่แปลงคะแนน (ดูคะแนนดิบได้)
            {!closed && <a href={`#/classes/${c.id}`}>ตั้งคะแนน</a>}</div>
        )}
        {uncollected.length > 0 && scoredExams.length > 0 && (
          <div className="alert info" data-testid="alert-uncollected">ยังไม่เก็บคะแนน: {uncollected.map((x) => (x.kind === 'final' ? 'สอบปลายภาค' : x.code ?? x.indicatorId)).join(', ')}</div>
        )}
        {absentCells > 0 && (
          <div className="alert info" data-testid="alert-absent">ขาดสอบ {absentCells} ช่อง ({s.absent_policy === 'zero' ? 'นับ 0 — ' : 'ไม่นับครั้งที่ขาด — '}
            ช่องที่มีป้าย "ขาด" · สร้างชุดสอบซ่อมแล้วคะแนนจะแทนให้เอง)</div>
        )}
      </div>

      <div className="tabs book-tabs" role="group" aria-label="แสดงคะแนน">
        {(Object.keys(VIEW_TH) as View[]).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{VIEW_TH[v]}</button>
        ))}
      </div>

      <div className="book-wrap">
        <table className="book" data-testid="book-table">
          <thead>
            <tr>
              <th className="seat" rowSpan={3}>ที่</th>
              {plan.map(({ col }) => <HeadCell key={col.id} col={col} part="top" onOpen={() => setSel({ kind: 'column', columnId: col.id })} />)}
              <th className="sum" rowSpan={2}>รวม</th>
              {fin && <HeadCell col={fin.col} part="top" onOpen={() => setSel({ kind: 'column', columnId: fin.col.id })} />}
              <th className="sum" rowSpan={2}>รวม</th>
            </tr>
            <tr>
              {plan.map(({ col }) => <HeadCell key={col.id} col={col} part="bottom" onOpen={() => setSel({ kind: 'column', columnId: col.id })} />)}
              {fin && <HeadCell col={fin.col} part="bottom" onOpen={() => setSel({ kind: 'column', columnId: fin.col.id })} />}
            </tr>
            <tr>
              {plan.map(({ col }) => <th key={col.id} data-testid={`max-${col.id}`}>{col.maxScore === null ? 'ยังไม่ตั้ง' : `เต็ม ${fmtScore(col.maxScore)}`}</th>)}
              <th className="sum">{fmtScore(collectMaxVisible)}</th>
              {fin && <th>เต็ม {fmtScore(fin.col.maxScore)}</th>}
              <th className="sum">{fmtScore(collectMaxVisible + (fin?.col.maxScore ?? 0))}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r) => (
              <tr key={r.seatNo} data-seat={r.seatNo}>
                <th className="seat" scope="row">{r.seatNo}</th>
                {plan.map(({ col, index }) => (
                  <BookCell key={col.id} cell={r.cells[index]} col={col} text={cellText(r.cells[index])} seatNo={r.seatNo} passRatio={passRatio}
                    selected={sel?.kind === 'cell' && sel.columnId === col.id && sel.seatNo === r.seatNo}
                    onOpen={() => setSel({ kind: 'cell', columnId: col.id, seatNo: r.seatNo })} />
                ))}
                <td className="sum" data-testid="total-collect">{view === 'raw' ? '' : fmtOrDash(view === 'real' ? sumReal(r.cells, plan.map((p) => p.index)) : sumVal(r.cells, plan.map((p) => p.index)))}</td>
                {fin && <BookCell cell={r.cells[fin.index]} col={fin.col} text={cellText(r.cells[fin.index])} seatNo={r.seatNo} passRatio={passRatio}
                  selected={sel?.kind === 'cell' && sel.columnId === fin.col.id && sel.seatNo === r.seatNo}
                  onOpen={() => setSel({ kind: 'cell', columnId: fin.col.id, seatNo: r.seatNo })} />}
                <td className="sum" data-testid="total">{view === 'raw' ? '' : fmtOrDash(view === 'real'
                  ? sumReal(r.cells, visible.map((p) => p.index)) : sumVal(r.cells, visible.map((p) => p.index)))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="seat">เฉลี่ย</td>
              {plan.map(({ col, index }) => <td key={col.id}>{fmtMean(columnStats(sheet, index, passRatio).mean)}</td>)}
              <td className="sum" />
              {fin && <td>{fmtMean(columnStats(sheet, fin.index, passRatio).mean)}</td>}
              <td className="sum" />
            </tr>
            <tr>
              <td className="seat" title="คะแนนจริงต่ำกว่าเกณฑ์ และยังไม่ได้ปรับ">ไม่ผ่าน</td>
              {plan.map(({ col, index }) => { const b = columnStats(sheet, index, passRatio).below;
                return <td key={col.id} className={b ? 'warnnum' : ''} data-testid={`below-${col.id}`}>{col.kind === 'other' ? '' : b}</td>; })}
              <td className="sum" />
              {fin && (() => { const b = columnStats(sheet, fin.index, passRatio).below;
                return <td className={b ? 'warnnum' : ''} data-testid={`below-${fin.col.id}`}>{b}</td>; })()}
              <td className="sum" />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="book-legend">
        <span><i style={{ background: 'var(--low-bg)' }} />คะแนนจริงต่ำกว่าเกณฑ์ {Math.round(passRatio * 100)}% (ยังไม่ปรับ)</span>
        <span><b style={{ color: 'var(--accent)' }}>*</b> ปรับคะแนนแล้ว (คะแนนจริงยังเก็บไว้)</span>
        <span>"ขาด" = ไม่มีผลสอบบางครั้ง</span>
        <span>กดช่องคะแนนเพื่อดูรายละเอียด / ปรับให้ผ่าน · กดหัวช่องเพื่อดูภาพรวมช่อง</span>
      </div>

      {sel?.kind === 'cell' && (
        <CellPanel key={`${sel.columnId}-${sel.seatNo}`} sheet={sheet} columnId={sel.columnId} seatNo={sel.seatNo} passRatio={passRatio} busy={busy} closed={closed}
          onClose={() => setSel(null)} onMove={(seatNo) => setSel({ ...sel, seatNo })} act={act} />
      )}
      {sel?.kind === 'column' && (
        <ColumnPanel key={sel.columnId} sheet={sheet} columnId={sel.columnId} passRatio={passRatio} busy={busy} closed={closed}
          onClose={() => setSel(null)} act={act} />
      )}
    </>
  );
}

const fmtOrDash = (v: number | null) => (v === null ? '–' : fmtScore(v));
const fmtMean = (v: number | null) => (v === null ? '–' : (Math.round(v * 10) / 10).toFixed(1));
function sumVal(cells: GbSheetCell[], idx: number[]) {
  const v = idx.map((k) => cells[k].value).filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}
function sumReal(cells: GbSheetCell[], idx: number[]) {
  const v = idx.map((k) => cells[k].real).filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

function HeadCell({ col, part, onOpen }: { col: GbSheetColumn; part: 'top' | 'bottom'; onOpen: () => void }) {
  const h = columnHead(col);
  const text = part === 'top' ? h.top : h.bottom;
  const title = col.kind === 'indicator' ? `${col.code ?? ''} ${col.text ?? ''}${col.collected ? '' : ' (ยังไม่เก็บคะแนน)'}` : undefined;
  return (
    <th className={`col-head${col.collected || col.kind === 'other' ? '' : ' uncollected'}`} title={title} data-col={col.id}>
      <button onClick={onOpen} aria-label={part === 'top' ? `ภาพรวมช่อง ${col.code ?? h.top}` : undefined} tabIndex={part === 'top' ? 0 : -1}>{text || ' '}</button>
    </th>
  );
}

function BookCell({ cell, col, text, seatNo, passRatio, selected, onOpen }: {
  cell: GbSheetCell; col: GbSheetColumn; text: string | null; seatNo: number; passRatio: number; selected: boolean; onOpen: () => void;
}) {
  const below = cell.adjusted === null && belowPass(cell, col.maxScore, passRatio);
  const cls = ['cell-td', below ? 'below' : '', cell.adjusted !== null ? 'adj' : '', selected ? 'selected' : ''].filter(Boolean).join(' ');
  const label = `เลขที่ ${seatNo} ${col.kind === 'final' ? 'สอบปลายภาค' : col.code ?? col.label ?? ''}`;
  return (
    <td className={cls} data-col={col.id}>
      <button onClick={onOpen} aria-label={label}>
        {text === null ? <span className="empty v">–</span> : <span className="v">{text}</span>}
        {cell.missing.length > 0 && <span className="tagline absent">ขาด</span>}
        {cell.adjusted !== null && cell.reason === 'pass' && <span className="tagline">ปรับผ่าน</span>}
      </button>
    </td>
  );
}

type Act = (fn: () => Promise<unknown>, okText: string) => Promise<void>;

function CellPanel({ sheet, columnId, seatNo, passRatio, busy, closed, onClose, onMove, act }: {
  sheet: GbSheet; columnId: number; seatNo: number; passRatio: number; busy: boolean; closed: boolean;
  onClose: () => void; onMove: (seat: number) => void; act: Act;
}) {
  const index = sheet.columns.findIndex((x) => x.id === columnId);
  const col = sheet.columns[index];
  const row = sheet.rows.find((r) => r.seatNo === seatNo);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!col || !row) return null;
  const cell = row.cells[index];
  const s = sheet.classroom.settings;
  const groups = seatDetail(sheet, columnId, seatNo);
  const pass = col.kind === 'other' ? null : passScore(col.maxScore, passRatio, s.rounding);
  const colName = col.kind === 'final' ? 'สอบปลายภาค' : col.kind === 'other' ? col.label ?? 'ช่องอื่น' : col.code ?? '';
  const isBelow = belowPass(cell, col.maxScore, passRatio);

  function save() {
    const p = parseAdjust(text, col.maxScore);
    if (!p.ok) { setErr(p.error); return; }
    setErr(null);
    act(() => repo.setOverride(col.id, seatNo, p.value, 'manual'),
      p.value === null ? `ยกเลิกการปรับ เลขที่ ${seatNo} แล้ว` : `ปรับ เลขที่ ${seatNo} เป็น ${fmtScore(p.value)} แล้ว`).then(() => setText(''));
  }

  return (
    <section className="book-panel" role="dialog" aria-label={`รายละเอียด เลขที่ ${seatNo}`} data-testid="cell-panel">
      <button className="btn ghost icon close" onClick={onClose} aria-label="ปิด">✕</button>
      <h2>เลขที่ {seatNo} · {colName}</h2>
      {col.kind === 'indicator' && <p className="ind-text" style={{ margin: 0 }}>{col.text}</p>}
      <dl className="kv" data-testid="cell-kv">
        <dt>ลงชีท</dt><dd data-testid="cell-value">{cell.value === null ? '–' : fmtScore(cell.value)}{col.maxScore !== null ? ` / ${fmtScore(col.maxScore)}` : ''}</dd>
        {col.kind !== 'other' && <>
          <dt>คะแนนจริง</dt>
          <dd data-testid="cell-real">{cell.real === null ? (col.maxScore === null ? 'ยังไม่ตั้งคะแนนเต็ม' : 'ยังไม่มีผลสอบ') : fmtScore(cell.real)}
            {isBelow && <span className="chip weak" style={{ marginLeft: 6 }}>ต่ำกว่าเกณฑ์</span>}</dd>
          <dt>คะแนนดิบสะสม</dt><dd data-testid="cell-raw">{cell.rawTotal ? `ถูก ${fmtScore(cell.rawCorrect)} จาก ${cell.rawTotal} ข้อ` : '–'}</dd>
        </>}
        {cell.adjusted !== null && <><dt>ปรับแล้ว</dt><dd data-testid="cell-adjusted">{fmtScore(cell.adjusted)} ({cell.reason === 'pass' ? 'ปรับให้ผ่าน' : 'แก้เอง'})</dd></>}
      </dl>

      {col.kind !== 'other' && (
        groups.length === 0
          ? <p className="sub">ยังไม่มีชุดข้อสอบที่ลงช่องนี้</p>
          : (
            <ul className="groups" data-testid="cell-groups">
              {groups.map((g) => (
                <li key={g.root}>
                  <div className="gtitle">{g.rootTitle} <span className="sub">({g.itemTotal} ข้อ)</span></div>
                  {g.absent
                    ? <p className="warn-text" style={{ margin: '4px 0 0' }}>ขาดสอบ — {s.absent_policy === 'zero' ? 'นับ 0' : 'ไม่นับครั้งนี้'}</p>
                    : (
                      <ul className="attempts">
                        {g.attempts.map((a) => (
                          <li key={a.examId} data-testid="attempt">
                            <span>{a.isRetake ? `สอบซ่อม · ${a.title}` : 'ครั้งแรก'}</span>
                            <strong>{a.correct}/{a.total}</strong>
                            {a.counted && <span className="counted">✓ นับครั้งนี้</span>}
                            {s.retake_policy === 'manual' && g.attempts.length > 1 && !closed && !(g.chosenExamId === a.examId) && (
                              <button className="btn ghost" disabled={busy}
                                onClick={() => act(() => repo.chooseRetake(g.root, seatNo, a.examId), `เลขที่ ${seatNo} นับ "${a.title}" แล้ว`)}>เลือกนับครั้งนี้</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  {s.retake_policy === 'manual' && g.chosenExamId && !closed && (
                    <button className="link" disabled={busy} onClick={() => act(() => repo.chooseRetake(g.root, seatNo, null), `เลขที่ ${seatNo} กลับไปนับครั้งที่ได้สูงสุด`)}>
                      ยกเลิกการเลือก (นับครั้งที่ได้สูงสุด)</button>
                  )}
                </li>
              ))}
            </ul>
          )
      )}
      {s.retake_policy !== 'manual' && groups.some((g) => g.attempts.length > 1) && (
        <p className="hint" style={{ marginTop: 0 }}>สอบหลายครั้ง: นับ{RETAKE_TH[s.retake_policy]} — อยากเลือกเองรายคน เปลี่ยน "สอบซ่อม" เป็น "ครูเลือกเองรายคน" ที่หน้าตั้งค่าห้อง</p>
      )}

      {!closed && (
        <div className="adjust">
          {pass !== null && cell.adjusted === null && (
            <button className="btn" disabled={busy || (cell.value !== null && cell.value >= pass)}
              onClick={() => act(() => repo.setOverride(col.id, seatNo, pass, 'pass'), `ปรับ เลขที่ ${seatNo} ให้ผ่าน (${fmtScore(pass)}) แล้ว`)}
              data-testid="adjust-pass">ปรับให้ผ่าน ({fmtScore(pass)})</button>
          )}
          <label className="inline-field">{col.kind === 'other' ? 'กรอกคะแนน' : 'ปรับเป็น'}
            <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label={col.kind === 'other' ? 'กรอกคะแนน' : 'ปรับเป็นคะแนน'}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }} placeholder={cell.adjusted !== null ? fmtScore(cell.adjusted) : ''} />
          </label>
          <button className="btn ghost" disabled={busy || text.trim() === ''} onClick={save}>บันทึก</button>
          {cell.adjusted !== null && (
            <button className="btn ghost" disabled={busy} data-testid="adjust-clear"
              onClick={() => act(() => repo.setOverride(col.id, seatNo, null, 'manual'), `ยกเลิกการปรับ เลขที่ ${seatNo} แล้ว (ใช้คะแนนจริง)`)}>
              {col.kind === 'other' ? 'ล้างคะแนน' : 'ยกเลิกการปรับ'}</button>
          )}
          {err && <p className="error small" role="alert">{err}</p>}
          {col.kind !== 'other' && <p className="hint" style={{ margin: 0, flexBasis: '100%' }}>คะแนนที่ปรับใช้ลงชีทส่งวิชาการ · ผลวิเคราะห์ยังใช้คะแนนจริง</p>}
        </div>
      )}
      <div className="nav">
        <button className="btn ghost" disabled={seatNo <= 1} onClick={() => onMove(seatNo - 1)}>← เลขที่ {seatNo - 1 || ''}</button>
        <button className="btn ghost" disabled={seatNo >= sheet.seatCount} onClick={() => onMove(seatNo + 1)}>เลขที่ {seatNo < sheet.seatCount ? seatNo + 1 : ''} →</button>
      </div>
    </section>
  );
}

function ColumnPanel({ sheet, columnId, passRatio, busy, closed, onClose, act }: {
  sheet: GbSheet; columnId: number; passRatio: number; busy: boolean; closed: boolean; onClose: () => void; act: Act;
}) {
  const [confirm, setConfirm] = useState(false);
  const index = sheet.columns.findIndex((x) => x.id === columnId);
  const col = sheet.columns[index];
  if (!col) return null;
  const st = columnStats(sheet, index, passRatio);
  const pass = col.kind === 'other' ? null : passScore(col.maxScore, passRatio, sheet.classroom.settings.rounding);
  const belowSeats = sheet.rows.filter((r) => r.cells[index].adjusted === null && belowPass(r.cells[index], col.maxScore, passRatio)).map((r) => r.seatNo);
  const exTitle = new Map(sheet.exams.map((e) => [e.id, e]));
  const colName = col.kind === 'final' ? 'สอบปลายภาค' : col.kind === 'other' ? col.label ?? 'ช่องอื่น' : col.code ?? '';

  return (
    <section className="book-panel" role="dialog" aria-label={`ภาพรวมช่อง ${colName}`} data-testid="column-panel">
      <button className="btn ghost icon close" onClick={onClose} aria-label="ปิด">✕</button>
      <h2>{colName}</h2>
      {col.kind === 'indicator' && <p className="ind-text" style={{ margin: 0 }}>{col.text}</p>}
      <dl className="kv">
        <dt>คะแนนเต็ม</dt><dd>{col.maxScore === null ? 'ยังไม่ตั้ง' : fmtScore(col.maxScore)}</dd>
        <dt>มีคะแนน</dt><dd>{st.n} / {sheet.seatCount} คน</dd>
        <dt>เฉลี่ย</dt><dd>{fmtMean(st.mean)}</dd>
        {col.kind !== 'other' && <><dt>ต่ำกว่าเกณฑ์</dt><dd data-testid="col-below">{st.below} คน{belowSeats.length ? ` (เลขที่ ${belowSeats.join(', ')})` : ''}</dd></>}
        <dt>ปรับแล้ว</dt><dd>{st.adjusted} คน</dd>
        {col.kind !== 'other' && <><dt>ขาดสอบ</dt><dd>{st.absent} คน</dd></>}
      </dl>
      {col.kind !== 'other' && (
        col.groups.length === 0
          ? <p className="sub">ยังไม่เก็บคะแนน — ยังไม่มีผลสอบที่ลงช่องนี้</p>
          : (
            <>
              <p className="sub" style={{ margin: '0 0 4px' }}>การสอบที่ลงช่องนี้ ({col.groups.length} ครั้ง)</p>
              <ul className="plain" data-testid="col-groups">
                {col.groups.map((g) => (
                  <li key={g.root}>
                    <a href={`#/exams/${g.root}`}>{exTitle.get(g.root)?.title ?? 'ชุดที่ลบแล้ว'}</a> <span className="sub">({g.itemTotal} ข้อ)</span>
                    {g.exams.length > 1 && <span className="sub"> + สอบซ่อม {g.exams.length - 1} ชุด</span>}
                  </li>
                ))}
              </ul>
            </>
          )
      )}
      {!closed && pass !== null && belowSeats.length > 0 && (
        !confirm
          ? <button className="btn" disabled={busy} onClick={() => setConfirm(true)} data-testid="bulk-pass">ปรับให้ผ่านทุกคนที่ต่ำกว่าเกณฑ์ ({belowSeats.length} คน)</button>
          : (
            <div className="confirm">
              <p>ปรับเลขที่ {belowSeats.join(', ')} เป็น {fmtScore(pass)} คะแนน? คะแนนจริงยังเก็บไว้ ยกเลิกการปรับทีละคนได้ภายหลัง</p>
              <div className="actions">
                <button className="btn" disabled={busy} data-testid="bulk-pass-confirm"
                  onClick={() => act(async () => { for (const seat of belowSeats) await repo.setOverride(col.id, seat, pass, 'pass'); },
                    `ปรับให้ผ่าน ${belowSeats.length} คน แล้ว`).then(() => setConfirm(false))}>ยืนยัน</button>
                <button className="btn ghost" onClick={() => setConfirm(false)}>ยกเลิก</button>
              </div>
            </div>
          )
      )}
      {!closed && <p className="hint">แก้คะแนนเต็ม / ลำดับช่อง ที่ <a href={`#/classes/${sheet.classroom.id}`}>ตั้งค่าห้อง</a></p>}
    </section>
  );
}
