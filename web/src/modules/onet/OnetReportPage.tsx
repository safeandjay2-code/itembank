// รายงานห้อง O-NET (SPEC-ONET §7): ภาพรวมห้อง · รายคน (แนวโน้ม + ควรเน้น) · รายข้อ (ตัวลวง) · ส่งออก Excel · ปิดห้อง
import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { href, navigate, type Route } from '../../ui/router';
import { download } from '../analysis/ReportPage';
import { thDate } from '../analysis/expiry';
import { Icon } from './Icon';
import { analyzeRoom, answerLabel, fmtScore, type GroupStat, type RoomAnalysis, type StudentSummary } from './analyze';
import { buildOnetXlsx, onetXlsxName } from './xlsx';
import type { OnetReportData } from './types';
import './onet.css';

type Tab = 'room' | 'students' | 'items';
const TABS: Array<[Tab, string]> = [['room', 'ภาพรวมห้อง'], ['students', 'รายคน'], ['items', 'รายข้อ']];
const pct = (p: number | null) => (p === null ? '–' : `${Math.round(p * 100)}%`);

function Bar({ p }: { p: number | null }) {
  const v = p ?? 0;
  return <div className={`bar ${v < 0.5 ? 'low' : ''}`} aria-hidden="true"><span style={{ width: `${Math.round(v * 100)}%` }} /></div>;
}

/** กราฟแนวโน้มคะแนนรายชุด (เต็ม 100) */
export function Trend({ scores, w = 120, h = 34 }: { scores: StudentSummary['scores']; w?: number; h?: number }) {
  const pts = scores.map((s, i) => ({ i, v: s.score })).filter((p) => p.v !== null) as Array<{ i: number; v: number }>;
  if (!pts.length) return null;
  const n = Math.max(scores.length - 1, 1);
  const x = (i: number) => 4 + (i / n) * (w - 8);
  const y = (v: number) => h - 4 - (Math.min(100, Math.max(0, v)) / 100) * (h - 8);
  return (
    <svg className="trend" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`แนวโน้ม ${pts.map((p) => fmtScore(p.v)).join(' → ')}`}>
      <line x1="2" x2={w - 2} y1={y(50)} y2={y(50)} stroke="var(--line)" strokeDasharray="3 3" />
      {pts.length > 1 && <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} />}
      {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3" fill="var(--accent)" />)}
    </svg>
  );
}

export function OnetReportPage({ id, route }: { id: string; route: Route }) {
  const [data, setData] = useState<OnetReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { repo.onet.report(id).then(setData, (e) => setError((e as Error).message)); }, [id]);
  const a = useMemo(() => (data ? analyzeRoom(data) : null), [data]);
  const tab = (route.params.get('tab') as Tab) || 'room';
  const seat = Number(route.params.get('seat')) || null;

  async function exportXlsx() {
    if (!data || !a) return;
    download(await buildOnetXlsx(data, a), onetXlsxName(data.room.name));
  }
  async function closeRoom() {
    if (!data) return;
    if (!confirm(`ปิดห้อง "${data.room.name}"?\nระบบจะดาวน์โหลด Excel ให้ก่อน แล้วลบผลรายเลขที่ทั้งหมด (ย้อนกลับไม่ได้)`)) return;
    setBusy(true);
    try { await exportXlsx(); await repo.onet.roomClose(id); navigate('/onet/rooms'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  if (error && !data) return <div className="error" role="alert">{error}</div>;
  if (!data || !a) return <p className="sub">กำลังโหลด…</p>;
  const setTab = (t: Tab) => navigate(`/onet/rooms/${id}/report`, { tab: t }, true);
  const student = seat ? a.students.find((s) => s.seatNo === seat) ?? null : null;

  return (
    <>
      <div className="crumb"><a href={href('/onet')}>ห้อง O-NET</a> › <a href={href('/onet/rooms')}>ห้องของฉัน</a> › {data.room.name}</div>
      <div className="page-head">
        <div>
          <h1>รายงาน · {data.room.name}</h1>
          <p className="sub" data-testid="onet-report-meta">นักเรียน {a.students.length} คน · {data.results.length} แผ่น · ผลรายคนลบอัตโนมัติ {thDate(data.room.expiresAt)}</p>
        </div>
        <div className="actions wrap" style={{ marginTop: 0 }}>
          {data.room.status === 'open' && <a className="btn ghost icon-btn" href={href(`/onet/rooms/${id}/scan`)}><Icon name="camera" /> สแกนต่อ</a>}
          <button className="btn" onClick={exportXlsx} disabled={!data.results.length} data-testid="onet-export"><Icon name="download" /> ส่งออก Excel</button>
        </div>
      </div>
      {error && <div className="error box" role="alert">{error}</div>}
      {!data.results.length && <div className="card">ยังไม่มีผลในห้องนี้ — <a href={href(`/onet/rooms/${id}/scan`)}>ไปสแกน</a></div>}

      {data.results.length > 0 && (
        <>
          <div className="tabs" role="group" aria-label="มุมมองรายงาน">
            {TABS.map(([t, l]) => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{l}</button>)}
          </div>
          {tab === 'room' && <RoomView a={a} />}
          {tab === 'students' && (student ? <StudentView s={student} data={data} roomId={id} /> : <StudentsTable a={a} roomId={id} />)}
          {tab === 'items' && <ItemsView a={a} />}
        </>
      )}

      {data.room.status === 'open' && (
        <section className="card" style={{ marginTop: 22 }}>
          <strong>ปิดห้อง</strong>
          <p className="sub" style={{ margin: '4px 0 8px' }}>หลังสอบ O-NET จริงแล้ว — ดาวน์โหลด Excel ฉบับสุดท้าย แล้วลบผลรายเลขที่ (เก็บไว้เฉพาะสถิติรวมรายข้อแบบไม่ระบุตัวตน)</p>
          <button className="btn ghost" onClick={closeRoom} disabled={busy} data-testid="onet-close-room">{busy ? 'กำลังปิด…' : 'ส่งออก Excel แล้วปิดห้อง'}</button>
        </section>
      )}
    </>
  );
}

function GroupTable({ title, rows, testid }: { title: string; rows: GroupStat[]; testid: string }) {
  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table className="onet-items" data-testid={testid}>
        <thead><tr><th></th><th className="num">ตอบถูก</th><th style={{ width: '35%' }}></th></tr></thead>
        <tbody>{rows.slice(0, 6).map((g) => (
          <tr key={g.key}><td>{g.key}</td><td className="num">{pct(g.p)}</td><td><Bar p={g.p} /></td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function RoomView({ a }: { a: RoomAnalysis }) {
  return (
    <>
      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>ค่าเฉลี่ยรายชุด</h3>
        <table className="onet-items" data-testid="onet-set-avg">
          <thead><tr><th>ชุด</th><th className="num">คน</th><th className="num">เฉลี่ย</th><th className="num">สูงสุด</th><th className="num">ต่ำสุด</th><th style={{ width: '30%' }}></th></tr></thead>
          <tbody>{a.sets.map((s) => (
            <tr key={s.code}><td>ชุดที่ {s.setNo}</td><td className="num">{s.n}</td><td className="num"><b>{fmtScore(s.avg)}</b></td>
              <td className="num">{fmtScore(s.max)}</td><td className="num">{fmtScore(s.min)}</td><td><Bar p={s.avg === null ? null : s.avg / s.fullScore} /></td></tr>
          ))}</tbody>
        </table>
      </section>
      <div className="onet-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <GroupTable title="ตัวชี้วัดที่อ่อนที่สุด" rows={a.weakIndicators} testid="onet-weak-ind" />
        <GroupTable title="แม่แบบที่อ่อนที่สุด" rows={a.weakTopics} testid="onet-weak-topic" />
      </div>
      <section className="card" data-testid="onet-lures">
        <h3 style={{ marginTop: 0 }}><Icon name="alert" /> ข้อที่เด็กหลงตัวลวง</h3>
        {!a.lures.length && <p className="sub" style={{ margin: 0 }}>ยังไม่มีข้อที่เด็กตอบผิดไปทางเดียวกันมาก (≥ 30%)</p>}
        {a.lures.map((l) => (
          <div key={`${l.setCode}-${l.itemNo}`} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <b>ชุดที่ {l.setNo} ข้อ {l.itemNo}</b> · {l.topic} — <span className="warn-text">{Math.round(l.share * 100)}% ตอบ {answerLabel(l.answer, l.kind)}</span> ({l.count} คน · ตอบถูก {pct(l.p)})
            {l.traps && <div className="muted">ความเข้าใจผิด: {l.traps}</div>}
          </div>
        ))}
      </section>
    </>
  );
}

function StudentsTable({ a, roomId }: { a: RoomAnalysis; roomId: string }) {
  return (
    <div className="table-wrap">
      <table className="onet-items" data-testid="onet-students">
        <thead><tr><th>เลขที่</th>{a.sets.map((s) => <th key={s.code} className="num">ชุด {s.setNo}</th>)}<th>แนวโน้ม</th><th>ควรเน้น</th><th></th></tr></thead>
        <tbody>{a.students.map((s) => (
          <tr key={s.seatNo}>
            <td><b>{s.seatNo}</b></td>
            {s.scores.map((x) => <td key={x.code} className="num">{fmtScore(x.score)}</td>)}
            <td><Trend scores={s.scores} /></td>
            <td>{s.focusTop.map((f) => f.key).join(' · ') || <span className="ok-text">ถูกทุกข้อ</span>}</td>
            <td><a href={href(`/onet/rooms/${roomId}/report`, { tab: 'students', seat: s.seatNo })}>ดู</a></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function StudentView({ s, data, roomId }: { s: StudentSummary; data: OnetReportData; roomId: string }) {
  return (
    <>
      <p><a href={href(`/onet/rooms/${roomId}/report`, { tab: 'students' })}>‹ นักเรียนทุกคน</a></p>
      <section className="card" style={{ marginBottom: 12 }} data-testid="onet-student">
        <h2 style={{ marginTop: 0 }}>เลขที่ {s.seatNo}</h2>
        <div className="onet-room" style={{ marginBottom: 0 }}>
          <div>
            {s.scores.map((x) => <div key={x.code}>ชุดที่ {x.setNo}: <b>{fmtScore(x.score)}</b></div>)}
            <div className="muted">เฉลี่ย {fmtScore(s.avg)} จาก {s.tested} ชุด</div>
          </div>
          <Trend scores={s.scores} w={260} h={80} />
        </div>
      </section>
      <section className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}><Icon name="target" /> ควรเน้นก่อนวันสอบ</h3>
        {!s.focusTop.length && <p className="ok-text">ถูกทุกข้อ</p>}
        <ol className="focus-list" data-testid="onet-focus">
          {s.focusTop.map((f) => <li key={f.key}><b>{f.key}</b> — ผิด {f.count}/{f.total} ข้อ เสีย {fmtScore(f.lost)} คะแนน{f.focus && <div className="muted">{f.focus}</div>}</li>)}
        </ol>
        {s.repeated.length > 0 && <p className="sub" style={{ margin: '10px 0 0' }}>พลาดซ้ำ (≥ 2 ครั้ง): {s.repeated.map((r) => `${r.key} (${r.count})`).join(' · ')}</p>}
        {s.indicators.length > 0 && <p className="sub" style={{ margin: '6px 0 0' }}>ตัวชี้วัดที่พลาด: {s.indicators.map((r) => `${r.key} (${r.count}/${r.total})`).join(' · ')}</p>}
      </section>
      {data.sets.map((set) => {
        const r = data.results.find((x) => x.setCode === set.code && x.seatNo === s.seatNo);
        if (!r) return null;
        const wrong = set.items.filter((i) => !r.correct[i.itemNo - 1]);
        return (
          <section key={set.code} className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>ชุดที่ {set.setNo}: {fmtScore(r.score)} คะแนน · ผิด {wrong.length} ข้อ</h3>
            {wrong.length > 0 && (
              <table className="onet-items">
                <thead><tr><th>ข้อ</th><th>ตอบ</th><th>แม่แบบ</th><th>ตัวชี้วัด</th></tr></thead>
                <tbody>{wrong.map((i) => <tr key={i.itemNo}><td>{i.itemNo}</td><td>{answerLabel(r.answers[i.itemNo - 1], i.kind)}</td><td>{i.topic}</td><td>{i.indicatorCode}</td></tr>)}</tbody>
              </table>
            )}
            {r.remarks.length > 0 && <p className="warn-text" style={{ marginBottom: 0 }}>{r.remarks.map((m) => m.message).join(' · ')}</p>}
          </section>
        );
      })}
    </>
  );
}

function ItemsView({ a }: { a: RoomAnalysis }) {
  return (
    <>
      {a.sets.map((s) => (
        <section key={s.code} className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>ชุดที่ {s.setNo} · {s.n} คน</h3>
          <div className="table-wrap">
            <table className="onet-items" data-testid={`onet-items-${s.code}`}>
              <thead><tr><th>ข้อ</th><th>แม่แบบ</th><th>ตัวชี้วัด</th><th className="num">ตอบถูก</th><th style={{ width: '18%' }}></th><th>ผิดบ่อย</th><th className="num">ไม่ตอบ</th></tr></thead>
              <tbody>{s.items.map((i) => (
                <tr key={i.itemNo}>
                  <td>{i.itemNo}</td><td>{i.topic}</td><td>{i.indicatorCode}</td><td className="num">{pct(i.p)}</td><td><Bar p={i.p} /></td>
                  <td>{i.topWrong ? `${answerLabel(i.topWrong.answer, i.kind)} (${i.topWrong.count})` : '–'}</td><td className="num">{i.blank || ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
