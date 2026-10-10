// รายงานผลสอบ (SPEC §9): ภาพรวมห้อง · รายเลขที่ · รายตัวชี้วัด · รายข้อ (p r ตัวลวง) · ส่งออก Excel / พิมพ์ PDF
// ชุดที่ปิด/หมดอายุแล้ว: แสดงเฉพาะค่ารวมที่เก็บไว้ (ไม่มีข้อมูลรายเลขที่แล้ว)
import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { EXAM_STATUS_TH, type ExamDetail, type ScanResponse } from '../../core/types';
import { href, navigate, type Route } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { analysisConfigFromSettings, analyze, difficultyOfP, rLabel, type AnalysisConfig, type ItemStat, OPTION_KEYS } from './analyze';
import { buildReportXlsx, compactSeats, fix, itemNotes, itemStatsFromRounds, makeNames, pct, reportFileName, type ReportNames } from './report';
import { XLSX_MIME } from './xlsx';
import { expiryText, thDate } from './expiry';
import './report.css';

type Tab = 'overview' | 'students' | 'indicators' | 'items';
const TABS: Array<[Tab, string]> = [['overview', 'ภาพรวมห้อง'], ['students', 'รายเลขที่'], ['indicators', 'รายตัวชี้วัด'], ['items', 'รายข้อ']];

export function download(data: Uint8Array | Blob, name: string, type = XLSX_MIME) {
  const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** โหลดชุดข้อสอบ + ผลตรวจ (ใช้ร่วมกับหน้าปิดชุด) */
export function useExamWithScans(id: string) {
  const [exam, setExam] = useState<ExamDetail | null | undefined>(undefined);
  const [scans, setScans] = useState<ScanResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const e = await repo.getExam(id);
        const s = e && (e.status === 'open' || e.status === 'draft') ? await repo.listScans(id) : [];
        if (alive) { setExam(e); setScans(s); }
      } catch (err) { if (alive) setError((err as Error).message); }
    })();
    return () => { alive = false; };
  }, [id, tick]);
  return { exam, scans, error, reload: () => setTick((t) => t + 1) };
}

export function ReportPage({ id, route, canOpenItems }: { id: string; route: Route; canOpenItems: boolean }) {
  const { data: ref, error: refError } = useRefData();
  const { exam, scans, error } = useExamWithScans(id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const tab = (TABS.find(([t]) => t === route.params.get('tab'))?.[0] ?? 'overview') as Tab;

  const cfg = useMemo(() => analysisConfigFromSettings(ref?.settings ?? {}), [ref]);
  const names = useMemo(() => (ref ? makeNames(ref.indicators, ref.difficulties, ref.grades) : null), [ref]);
  const closed = exam && (exam.status === 'closed' || exam.status === 'expired');
  const analysis = useMemo(() => (exam && !closed ? analyze(exam, scans, cfg) : null), [exam, scans, cfg, closed]);

  if (error || refError) return <div className="error" role="alert">{error ?? refError}</div>;
  if (exam === undefined || !ref || !names) return <p className="sub">กำลังโหลด…</p>;
  if (exam === null) return <div className="card">ไม่พบชุดข้อสอบนี้ · <a href="#/reports">กลับไปรายงานผล</a></div>;

  async function excel() {
    if (!analysis) return;
    setBusy(true);
    setMsg(null);
    try {
      download(await buildReportXlsx(exam!, analysis, names!), reportFileName(exam!, names!));
      setMsg('ดาวน์โหลดไฟล์ Excel แล้ว');
    } catch (e) { setMsg(`สร้างไฟล์ไม่สำเร็จ: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  const setTab = (t: Tab) => navigate(`/exams/${id}/report`, { tab: t === 'overview' ? undefined : t }, true);
  const hidden = (t: Tab) => (t === tab ? '' : ' tab-hidden');
  const items = analysis ? analysis.items : itemStatsFromRounds(exam, cfg);
  const sum = closed ? exam.closedSummary : null;

  return (
    <div className="report-doc" data-testid="report">
      <div className="crumb no-print"><a href="#/reports">รายงานผล</a> › <a href={href(`/exams/${exam.id}`)}>{exam.title}</a></div>
      <div className="page-head">
        <div>
          <h1>รายงานผล: {exam.title}</h1>
          <p className="sub" data-testid="report-meta">
            {names.grade(exam.gradeId)} · {exam.itemCount} ข้อ · {exam.setCount} ชุด · <span className={`chip ex-${exam.status}`}>{EXAM_STATUS_TH[exam.status]}</span>
            {analysis && <> · ตรวจแล้ว {analysis.summary.n}/{exam.studentCount} คน</>}
          </p>
        </div>
        <div className="actions wrap no-print" style={{ marginTop: 0 }}>
          {analysis && <button className="btn" disabled={busy || analysis.summary.n === 0} onClick={excel} data-testid="download-xlsx">ดาวน์โหลด Excel</button>}
          <button className="btn ghost" onClick={() => window.print()} data-testid="print-report">พิมพ์ / บันทึก PDF</button>
          {exam.status === 'open' && <a className="btn ghost" href={href(`/exams/${exam.id}/close`)} data-testid="go-close">ปิดชุดข้อสอบ…</a>}
        </div>
      </div>
      {msg && <div className="notice no-print" role="status">{msg}</div>}

      {closed && sum && (
        <div className="notice" data-testid="closed-banner">
          {exam.status === 'expired' ? 'หมดอายุ' : 'ปิดชุด'}เมื่อ {thDate(exam.closedAt)} — คะแนนและคำตอบรายเลขที่ถูกลบจากระบบแล้ว ·
          บันทึกสถิติรายข้อเข้าคลัง {sum.itemsRecorded} ข้อ (n = {sum.n})
        </div>
      )}
      {analysis && exam.status === 'open' && exam.expiresAt && <p className="sub" data-testid="report-expiry">{expiryText(exam.expiresAt)} — ส่งออกรายงานแล้วปิดชุดได้ทุกเมื่อ</p>}
      {analysis && analysis.summary.n === 0 && (
        <div className="card empty">ยังไม่มีผลตรวจ · <a href={href(`/exams/${exam.id}/scan`)}>ไปตรวจกระดาษคำตอบ</a></div>
      )}

      {(analysis ? analysis.summary.n > 0 : true) && (
        <>
          <div className="tabs report-tabs no-print" role="group" aria-label="มุมมองรายงาน">
            {TABS.filter(([t]) => t !== 'students' || !closed).map(([t, label]) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>

          <section className={`report-section${hidden('overview')}`} data-testid="sec-overview">
            {analysis ? <Overview exam={exam} a={analysis} names={names} cfg={cfg} /> : sum && <ClosedOverview sum={sum} />}
          </section>
          {analysis && (
            <section className={`report-section${hidden('students')}`} data-testid="sec-students">
              <Students exam={exam} a={analysis} names={names} />
            </section>
          )}
          <section className={`report-section${hidden('indicators')}`} data-testid="sec-indicators">
            <Indicators rows={analysis ? analysis.indicators.map((x) => ({ ...x }))
              : (sum?.indicators ?? []).map((x) => ({ ...x, passRate: sum!.n ? x.passCount / sum!.n : null, weak: !!sum!.n && x.passCount / sum!.n < 0.5 }))}
              n={analysis ? analysis.summary.n : sum?.n ?? 0} names={names} passRatio={analysis ? cfg.passRatio : sum?.passRatio ?? cfg.passRatio} />
          </section>
          <section className={`report-section${hidden('items')}`} data-testid="sec-items">
            <Items exam={exam} items={items} names={names} cfg={cfg} canOpenItems={canOpenItems} closed={!!closed} />
          </section>
        </>
      )}
    </div>
  );
}

function Overview({ exam, a, names, cfg }: { exam: ExamDetail; a: NonNullable<ReturnType<typeof analyze>>; names: ReportNames; cfg: AnalysisConfig }) {
  const s = a.summary;
  const weak = a.indicators.filter((x) => x.weak);
  const attention = a.items.filter((i) => i.r !== null && i.r < cfg.rFlagBelow);
  const hardest = a.items.filter((i) => i.p !== null).slice().sort((x, y) => x.p! - y.p!).slice(0, 3);
  return (
    <>
      <h2>ภาพรวมห้อง</h2>
      <div className="cards">
        <Stat label="ตรวจแล้ว" value={`${s.n}`} small={`/ ${s.studentCount} คน`} testid="ov-n" />
        <Stat label="คะแนนเฉลี่ย" value={fix(s.mean)} small={`/ ${s.itemCount} (${fix(s.meanPercent, 1)}%)`} testid="ov-mean" />
        <Stat label="ส่วนเบี่ยงเบนมาตรฐาน" value={fix(s.sd)} testid="ov-sd" />
        <Stat label="มัธยฐาน" value={s.median === null ? '–' : String(s.median)} testid="ov-median" />
        <Stat label="ต่ำสุด – สูงสุด" value={s.min === null ? '–' : `${s.min} – ${s.max}`} testid="ov-range" />
      </div>
      {(s.missingSeats.length > 0 || s.unresolvedSeats.length > 0) && (
        <ul className="qa-list">
          {s.missingSeats.length > 0 && <li className="qa-warn" data-testid="ov-missing">ยังไม่ตรวจ/ขาดสอบ: เลขที่ {compactSeats(s.missingSeats)} — ไม่นับในค่าสถิติ</li>}
          {s.unresolvedSeats.length > 0 && <li className="qa-alert">มี remark ยังไม่ยืนยัน: เลขที่ {compactSeats(s.unresolvedSeats)} · <a className="no-print" href={href(`/exams/${exam.id}/scan`, { tab: 'results' })}>ไปตรวจทาน</a></li>}
        </ul>
      )}
      <div className="card report-section">
        <h2>การกระจายคะแนน (ร้อยละ)</h2>
        <Histogram h={s.histogram} />
      </div>
      <div className="card report-section">
        <h2>ตัวชี้วัดที่ควรสอนซ่อม</h2>
        {weak.length ? (
          <ul className="plain" data-testid="ov-weak">
            {weak.map((x) => <li key={x.indicatorId}><b>{names.indicator(x.indicatorId)?.code}</b> ผ่าน {x.passCount}/{s.n} คน ({pct(x.passRate)}) — {names.indicator(x.indicatorId)?.text}</li>)}
          </ul>
        ) : <p className="sub" data-testid="ov-weak">ไม่มี — ทุกตัวชี้วัดผ่านอย่างน้อยครึ่งห้อง (เกณฑ์ผ่านตัวชี้วัด {Math.round(cfg.passRatio * 100)}%)</p>}
      </div>
      <div className="card report-section">
        <h2>ข้อที่ควรดู</h2>
        <ul className="plain">
          {hardest.map((i) => <li key={i.itemId}>ข้อ {i.basePosition} ({i.itemCode}) ตอบถูกน้อย p = {fix(i.p)}</li>)}
          {attention.map((i) => <li key={`r${i.itemId}`}>ข้อ {i.basePosition} ({i.itemCode}) อำนาจจำแนก r = {fix(i.r)} — {rLabel(i.r, cfg).text}</li>)}
        </ul>
        {a.summary.n < cfg.rMinN && <p className="sub">ตรวจแล้วน้อยกว่า {cfg.rMinN} คน จึงยังไม่คำนวณค่า r</p>}
      </div>
    </>
  );
}

function ClosedOverview({ sum }: { sum: NonNullable<ExamDetail['closedSummary']> }) {
  return (
    <>
      <h2>ภาพรวมห้อง (ค่าที่เก็บไว้ตอนปิดชุด)</h2>
      <div className="cards">
        <Stat label="จำนวนที่ตรวจ" value={`${sum.n}`} small={`/ ${sum.studentCount} คน`} testid="ov-n" />
        <Stat label="คะแนนเฉลี่ย" value={fix(sum.mean)} small={`/ ${sum.itemCount} (${fix(sum.meanPercent, 1)}%)`} testid="ov-mean" />
        <Stat label="ส่วนเบี่ยงเบนมาตรฐาน" value={fix(sum.sd)} />
        <Stat label="มัธยฐาน" value={sum.median === null ? '–' : String(sum.median)} />
        <Stat label="ต่ำสุด – สูงสุด" value={sum.min === null ? '–' : `${sum.min} – ${sum.max}`} />
      </div>
      <div className="card report-section"><h2>การกระจายคะแนน (ร้อยละ)</h2><Histogram h={sum.histogram} /></div>
    </>
  );
}

function Stat({ label, value, small, testid }: { label: string; value: string; small?: string; testid?: string }) {
  return <div className="card"><div className="stat-label">{label}</div><div className="stat-value" data-testid={testid}>{value}{small && <small>{small}</small>}</div></div>;
}

function Histogram({ h }: { h: number[] }) {
  const max = Math.max(1, ...h);
  return (
    <ul className="bars" data-testid="histogram">
      {h.map((c, i) => (i === 9 ? [90, 100] : [i * 10, i * 10 + 9])).map(([lo, hi], i) => (
        <li key={i}><span>{lo}–{hi}</span><span className="bar"><span style={{ width: `${(100 * h[i]) / max}%` }} /></span><span className="num">{h[i]} คน</span></li>
      )).reverse()}
    </ul>
  );
}

function Students({ exam, a, names }: { exam: ExamDetail; a: NonNullable<ReturnType<typeof analyze>>; names: ReportNames }) {
  const by = new Map(a.students.map((s) => [s.seatNo, s]));
  return (
    <>
      <h2>คะแนนรายเลขที่</h2>
      <p className="sub">ผ่านตัวชี้วัด = ตอบถูกอย่างน้อย {Math.round(a.config.passRatio * 100)}% ของข้อในตัวชี้วัดนั้น · ตัวเลขในช่อง = ข้อที่ตอบถูก/จำนวนข้อ</p>
      <div className="table-wrap">
        <table className="report-table" data-testid="student-table">
          <thead>
            <tr>
              <th>เลขที่</th><th>ชุด</th><th>คะแนน</th><th>ร้อยละ</th>
              {a.indicators.map((x) => <th key={x.indicatorId} title={names.indicator(x.indicatorId)?.text}>{names.indicator(x.indicatorId)?.code ?? x.indicatorId}</th>)}
              <th>ผ่าน</th>
            </tr>
          </thead>
          <tbody>
            {exam.seats.map(({ seatNo, setNo }) => {
              const s = by.get(seatNo);
              if (!s) return <tr key={seatNo} className="missing"><td>{seatNo}</td><td>{setNo}</td><td colSpan={3 + a.indicators.length}>ยังไม่ตรวจ / ขาดสอบ</td></tr>;
              return (
                <tr key={seatNo} data-seat={seatNo}>
                  <td>{seatNo}</td><td>{s.setNo}</td><td><b>{s.score}</b></td><td>{s.percent.toFixed(0)}</td>
                  {s.indicators.map((x, j) => <td key={j} className={x.pass ? 'pass' : 'fail'}>{x.correct}/{x.total} {x.pass ? '✓' : '✗'}</td>)}
                  <td>{s.passedIndicators}/{a.indicators.length}{s.unresolved > 0 && <span className="chip weak" title="มี remark ยังไม่ยืนยัน"> remark</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface IndRow { indicatorId: string; itemCount: number; meanRatio: number | null; passCount: number; passRate: number | null; weak: boolean }
function Indicators({ rows, n, names, passRatio }: { rows: IndRow[]; n: number; names: ReportNames; passRatio: number }) {
  return (
    <>
      <h2>ผลรายตัวชี้วัด</h2>
      <p className="sub">เกณฑ์ผ่าน: ตอบถูกอย่างน้อย {Math.round(passRatio * 100)}% ของข้อในตัวชี้วัด · "ควรสอนซ่อม" = ผ่านไม่ถึงครึ่งห้อง</p>
      <div className="table-wrap">
        <table className="report-table" data-testid="indicator-table">
          <thead><tr><th className="left">ตัวชี้วัด</th><th>ข้อ</th><th>ตอบถูกเฉลี่ย</th><th>ผ่าน</th><th>สถานะ</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.indicatorId}>
                <td className="left"><b>{names.indicator(x.indicatorId)?.code ?? x.indicatorId}</b><div className="sub" style={{ margin: 0, fontSize: '.82rem' }}>{names.indicator(x.indicatorId)?.text}</div></td>
                <td>{x.itemCount}</td>
                <td>{pct(x.meanRatio)}</td>
                <td>{x.passCount}/{n} ({pct(x.passRate)})</td>
                <td>{x.passRate === null ? '–' : x.weak ? <span className="chip weak">ควรสอนซ่อม</span> : <span className="chip r-good">ผ่านเกินครึ่ง</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Items({ exam, items, names, cfg, canOpenItems, closed }: { exam: ExamDetail; items: ItemStat[]; names: ReportNames; cfg: AnalysisConfig; canOpenItems: boolean; closed: boolean }) {
  const content = new Map(exam.items.map((i) => [i.itemId, i.content]));
  return (
    <>
      <h2>วิเคราะห์รายข้อ</h2>
      <p className="sub">
        p = สัดส่วนผู้ตอบถูก · r = อำนาจจำแนก (เทคนิค 27%{closed ? '' : `, ตรวจแล้วอย่างน้อย ${cfg.rMinN} คน`}) ·
        ตัวเลือกเรียงตามต้นฉบับในคลัง (กระดาษแต่ละชุดสลับลำดับ) · แถบส้ม = ตัวลวงที่เด็กหลงมาก
      </p>
      <ol className="item-cards" data-testid="item-cards">
        {items.map((it) => {
          const c = content.get(it.itemId);
          const lvl = difficultyOfP(it.p, names.difficulties);
          const rl = rLabel(it.r, cfg);
          const notes = itemNotes(it, cfg, names, (o) => c?.options?.[o - 1] ?? '');
          const strong = new Set(it.distractors.filter((d) => d.strong).map((d) => d.option));
          return (
            <li key={it.itemId} className="item-card" data-item={it.itemCode}>
              <div className="item-top">
                <strong>ข้อ {it.basePosition}</strong>
                {canOpenItems ? <a className="code mono no-print" href={`#/items/${it.itemId}`}>{it.itemCode}</a> : <span className="mono">{it.itemCode}</span>}
                <span className="sub" style={{ margin: 0 }}>{names.indicator(it.indicatorId)?.code} · คลัง: {names.difficulty(it.difficulty)}</span>
                <span className="sub" style={{ margin: 0, fontSize: '.82rem' }}>{Object.entries(it.positions).map(([s, p]) => `ชุด ${s} ข้อ ${p}`).join(' · ')}</span>
              </div>
              {c?.stem && <div className="item-stem">{c.stem}</div>}
              <div className="metrics">
                <span>ตอบถูก <b>{it.nCorrect}/{it.n}</b></span>
                <span data-testid="p">p = <b>{fix(it.p)}</b>{lvl && ` (${lvl.nameTh})`}</span>
                <span data-testid="r">r = <b>{fix(it.r)}</b> <span className={`chip r-${rl.level}`}>{rl.text}</span></span>
              </div>
              <ul className="opt-bars">
                {OPTION_KEYS.filter((k) => !(k === 'blank' || k === 'multi') || it.counts[k] > 0).map((k) => {
                  const cnt = it.counts[k];
                  const isKey = String(it.answer) === k;
                  const label = k === 'blank' ? 'ไม่ฝน' : k === 'multi' ? 'ฝนหลายช่อง' : `${k}) ${c?.options?.[Number(k) - 1] ?? ''}`;
                  return (
                    <li key={k} className={`${isKey ? 'key' : ''}${strong.has(Number(k)) ? ' strong' : ''}`}>
                      <span className="txt" title={label}>{isKey ? '✓ ' : ''}{label}</span>
                      <span className="bar"><span style={{ width: `${it.n ? (100 * cnt) / it.n : 0}%` }} /></span>
                      <span className="num">{cnt} ({it.n ? Math.round((100 * cnt) / it.n) : 0}%)</span>
                    </li>
                  );
                })}
              </ul>
              {notes.length > 0 && <ul className="item-notes" data-testid="item-notes">{notes.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </li>
          );
        })}
      </ol>
    </>
  );
}
