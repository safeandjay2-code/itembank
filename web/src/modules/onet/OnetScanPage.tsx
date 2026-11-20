// สแกนกระดาษคำตอบ O-NET เข้าห้อง (SPEC-ONET §6) — กล้องมือถือ (หลัก) · อัปโหลดภาพ/PDF (เสริม) · ผลในห้อง
//   ชุดมาจาก QR · เลขที่ไม่ชัด/อ่านไม่ได้ → หยุดถามครู (ไม่บันทึกเงียบ) · เลขที่ซ้ำ → ให้ครูเลือกแทนที่/คงเดิม/แก้เลขที่
//   ภาพไม่ออกจากเครื่อง ส่งเฉพาะคำตอบดิบ — เซิร์ฟเวอร์ตรวจคะแนนเอง (เฉลยไม่มาถึงเครื่องครู)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { repo } from '../../data';
import { href, navigate, type Route } from '../../ui/router';
import { DEFAULT_SCAN, scanConfigFromSettings, type ScanConfig } from '../scan/grade';
import { SheetReader, readOnet } from '../scan/reader';
import { fileImages, videoFrame } from '../scan/sources';
import { feedback, unlockAudio } from '../scan/feedback';
import type { OnetReadResult } from '../scan/omr';
import { Icon } from './Icon';
import { OnetStabilizer, processRead, scoreText, submitInput, type OnetRead } from './scanFlow';
import { answerLabel } from './analyze';
import type { OnetReportData, OnetRoom, OnetSetSummary, OnetSubmitResult } from './types';
import './onet.css';

type Tab = 'camera' | 'upload' | 'results';
type Read = Extract<OnetRead, { kind: 'read' }>;

/** เรื่องที่ต้องถามครู (กล้องหยุดอ่านจนกว่าครูตอบ) */
type Pending =
  | { id: number; type: 'seat'; read: Read; label: string }
  | { id: number; type: 'dup'; read: Read; seatNo: number; old: number; label: string };

interface Done { kind: 'ok' | 'remark' | 'warn' | 'dup'; title: string; detail?: string }

let pendSeq = 0;

export function OnetScanPage({ id, route }: { id: string; route: Route }) {
  const [room, setRoom] = useState<OnetRoom | null | undefined>(undefined);
  const [sets, setSets] = useState<OnetSetSummary[]>([]);
  const [cfg, setCfg] = useState<ScanConfig>(DEFAULT_SCAN);
  const [pending, setPending] = useState<Pending[]>([]);
  const [last, setLast] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const tab = (route.params.get('tab') as Tab) || 'camera';
  const reader = useMemo(() => new SheetReader(), []);
  useEffect(() => () => reader.dispose(), [reader]);

  const refreshRoom = useCallback(() => repo.onet.roomList().then((rs) => {
    const r = rs.find((x) => x.id === id) ?? null;
    setRoom(r); if (r) setCount(r.sheets);
  }, (e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    refreshRoom();
    repo.onet.catalog().then((c) => setSets(c.sets), (e) => setError((e as Error).message));
    repo.getSettings().then((s) => setCfg(scanConfigFromSettings(s)), () => {});   // บัญชี onet อ่านค่าตั้งไม่ได้ → ค่าเริ่มต้น
  }, [refreshRoom]);

  /** บันทึก 1 แผ่น → คืนผลให้ผู้เรียกแสดง/ส่งเสียง */
  const submit = useCallback(async (r: Read, seatNo: number, replace = false): Promise<OnetSubmitResult | null> => {
    try {
      const res = await repo.onet.submit(submitInput(id, r, seatNo, replace));
      if (res.status === 'duplicate') {
        setPending((p) => [...p, { id: ++pendSeq, type: 'dup', read: r, seatNo, old: res.existing.score, label: `ชุดที่ ${r.setNo}` }]);
        feedback('warn');
        setLast({ kind: 'dup', title: `เลขที่ ${seatNo} ชุดที่ ${r.setNo} สแกนไปแล้ว`, detail: 'เลือกด้านบนว่าจะใช้ผลใหม่หรือไม่' });
      } else {
        if (res.status === 'saved') setCount((c) => c + 1);
        const rem = submitInput(id, r, seatNo).remarks;
        feedback(rem.length ? 'remark' : 'ok');
        setLast({ kind: rem.length ? 'remark' : 'ok', title: `เลขที่ ${seatNo} · ชุดที่ ${r.setNo} · ${scoreText(res.score)} คะแนน (ถูก ${res.correctCount}/${res.itemCount} ข้อ)`,
          detail: rem.length ? rem.map((m) => m.message).join(' · ') : res.status === 'replaced' ? 'แทนที่ผลเดิมแล้ว' : 'บันทึกแล้ว — แผ่นถัดไป' });
      }
      return res;
    } catch (e) {
      feedback('warn');
      setLast({ kind: 'warn', title: `บันทึกเลขที่ ${seatNo} ไม่สำเร็จ`, detail: (e as Error).message });
      return null;
    }
  }, [id]);

  /** ผลอ่านที่ผ่านด่านแล้ว: เลขที่ชัด → บันทึก · ไม่ชัด → ถามครู */
  const accept = useCallback(async (r: Read, label: string): Promise<{ text: string; kind: Done['kind'] }> => {
    if (r.interp.seat.status === 'ok') {
      const seat = r.interp.seat.value!;
      const res = await submit(r, seat);
      if (!res) return { text: `ชุดที่ ${r.setNo} · เลขที่ ${seat}: บันทึกไม่สำเร็จ`, kind: 'warn' };
      if (res.status === 'duplicate') return { text: `ชุดที่ ${r.setNo} · เลขที่ ${seat}: สแกนไปแล้ว — เลือกด้านบน`, kind: 'dup' };
      const rem = submitInput(id, r, seat).remarks.length;
      return { text: `ชุดที่ ${r.setNo} · เลขที่ ${seat} · ${scoreText(res.score)} คะแนน${rem ? ` · remark ${rem}` : ''}`, kind: rem ? 'remark' : 'ok' };
    }
    feedback('warn');
    setPending((p) => [...p, { id: ++pendSeq, type: 'seat', read: r, label }]);
    return { text: `ชุดที่ ${r.setNo} · เลขที่ไม่ชัด — ถามครูด้านบน`, kind: 'dup' };
  }, [submit, id]);

  if (room === undefined) return error ? <div className="error" role="alert">{error}</div> : <p className="sub">กำลังโหลด…</p>;
  if (room === null) return <div className="card">ไม่พบห้องนี้ · <a href={href('/onet/rooms')}>กลับไปห้องของฉัน</a></div>;
  const closed = room.status !== 'open';
  const setTab = (t: Tab) => navigate(`/onet/rooms/${id}/scan`, { tab: t }, true);
  const ask = pending[0] ?? null;
  const resolve = (pid: number) => setPending((p) => p.filter((x) => x.id !== pid));

  return (
    <>
      <div className="crumb"><a href={href('/onet')}>ห้อง O-NET</a> › <a href={href('/onet/rooms')}>ห้องของฉัน</a> › {room.name}</div>
      <div className="page-head">
        <div>
          <h1>สแกน · {room.name}</h1>
          <p className="sub" data-testid="onet-scan-meta">บันทึกแล้ว {count} แผ่น · ชุดอ่านจาก QR บนกระดาษเอง</p>
        </div>
        <a className="btn ghost icon-btn" href={href(`/onet/rooms/${id}/report`)}><Icon name="chart" /> รายงาน</a>
      </div>
      {closed && <div className="error box" role="alert">ห้องนี้ปิดแล้ว สแกนเพิ่มไม่ได้</div>}
      {error && <div className="error box" role="alert">{error}</div>}

      {ask && <AskCard key={ask.id} p={ask} more={pending.length - 1}
        onSeat={async (seat) => { resolve(ask.id); await submit(ask.read, seat, false); }}
        onReplace={async () => { resolve(ask.id); if (ask.type === 'dup') await submit(ask.read, ask.seatNo, true); }}
        onSkip={() => { resolve(ask.id); setLast({ kind: 'warn', title: 'ข้ามแผ่นนี้แล้ว (ไม่บันทึก)' }); }} />}

      {last && !ask && (
        <div className={`scan-last ${last.kind}`} data-testid="onet-last" style={{ marginBottom: 12 }}>
          <b>{last.title}</b>{last.detail && <span>{last.detail}</span>}
        </div>
      )}

      <div className="tabs" role="group" aria-label="วิธีสแกน">
        <button aria-pressed={tab === 'camera'} onClick={() => setTab('camera')}>กล้อง</button>
        <button aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>อัปโหลดภาพ/PDF</button>
        <button aria-pressed={tab === 'results'} onClick={() => setTab('results')}>ผลในห้อง ({count})</button>
      </div>
      {tab === 'camera' && !closed && <Camera reader={reader} sets={sets} cfg={cfg} paused={!!ask} onAccept={(r) => accept(r, 'จากกล้อง')} />}
      {tab === 'upload' && !closed && <Upload reader={reader} sets={sets} cfg={cfg} onAccept={accept} />}
      {tab === 'results' && <Results roomId={id} closed={closed} onChange={refreshRoom} />}
    </>
  );
}

// ---------------------------------------------------------------- ถามครู
function AskCard({ p, more, onSeat, onReplace, onSkip }: {
  p: Pending; more: number; onSeat: (seat: number) => void; onReplace: () => void; onSkip: () => void;
}) {
  const s = p.read.interp.seat;
  const [v, setV] = useState(p.type === 'seat' ? (s.suggested ? String(s.suggested) : '') : String(p.seatNo));
  const n = Number(v);
  const valid = /^\d{1,2}$/.test(v) && n >= 1 && n <= 99;
  const why = p.read.interp.remarks.find((m) => m.code.startsWith('seat_'))?.message;
  return (
    <section className="card seat-ask" role="alertdialog" aria-label="ต้องให้ครูยืนยัน" data-testid="onet-ask" style={{ marginBottom: 12 }}>
      {p.type === 'seat' ? (
        <>
          <h3 style={{ marginTop: 0 }}><Icon name="alert" /> {s.status === 'confirm' ? 'ยืนยันเลขที่' : 'พิมพ์เลขที่'} · ชุดที่ {p.read.setNo} ({p.label})</h3>
          <p className="sub" style={{ margin: '0 0 8px' }}>{why ?? 'อ่านเลขที่ไม่ได้'} — ดูเลขที่บนกระดาษจริงแล้วพิมพ์</p>
        </>
      ) : (
        <>
          <h3 style={{ marginTop: 0 }}><Icon name="alert" /> เลขที่ {p.seatNo} ชุดที่ {p.read.setNo} สแกนไปแล้ว</h3>
          <p className="sub" style={{ margin: '0 0 8px' }}>ผลเดิม {scoreText(p.old)} คะแนน — ใช้ผลใหม่แทน หรือแก้เลขที่ถ้าเด็กระบายผิด</p>
        </>
      )}
      <div className="actions wrap" style={{ alignItems: 'center' }}>
        <input inputMode="numeric" aria-label="เลขที่" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, '').slice(0, 2))} autoFocus />
        {p.type === 'dup' && v === String(p.seatNo)
          ? <button className="btn" onClick={onReplace}>ใช้ผลใหม่ (แทนที่)</button>
          : <button className="btn" disabled={!valid} onClick={() => onSeat(n)}>บันทึกเลขที่ {valid ? n : ''}</button>}
        <button className="btn ghost" onClick={onSkip}>{p.type === 'dup' ? 'คงผลเดิม' : 'ข้ามแผ่นนี้'}</button>
        {more > 0 && <span className="hint" style={{ margin: 0 }}>รออีก {more} แผ่น</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- กล้อง
function Camera({ reader, sets, cfg, paused, onAccept }: {
  reader: SheetReader; sets: OnetSetSummary[]; cfg: ScanConfig; paused: boolean; onAccept: (r: Read) => Promise<unknown>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(false);
  const pausedRef = useRef(paused);
  const setsRef = useRef(sets);
  pausedRef.current = paused;
  setsRef.current = sets;
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState('');
  const [res, setRes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const stop = useCallback(() => {
    runRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOn(false);
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    unlockAudio();
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErr('อุปกรณ์/เบราว์เซอร์นี้เปิดกล้องในหน้าเว็บไม่ได้ — ใช้แท็บ "อัปโหลดภาพ/PDF" แทน'); return; }
    try {
      // A4 ทั้งแผ่นต้องการความละเอียดมากกว่ากระดาษ A5 ของระบบหลัก → ขอ 2560×1440 (ได้ไม่ถึงก็ใช้เท่าที่ได้)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setRes(`${v.videoWidth}×${v.videoHeight}`);
      setOn(true);
      runRef.current = true;
      loop();
    } catch (e) {
      setErr(`เปิดกล้องไม่ได้: ${(e as Error).message} — ตรวจว่าอนุญาตให้เว็บนี้ใช้กล้องแล้ว`);
    }
  }

  function overlay(r: OnetReadResult | null) {
    const c = overlayRef.current, v = videoRef.current;
    if (!c || !v) return;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    if (!r || !r.ok) return;
    const [tl, tr, bl, br] = r.corners;
    g.strokeStyle = '#22c55e'; g.lineWidth = Math.max(4, c.width / 250);
    g.beginPath(); g.moveTo(tl.x, tl.y); g.lineTo(tr.x, tr.y); g.lineTo(br.x, br.y); g.lineTo(bl.x, bl.y); g.closePath(); g.stroke();
  }

  async function loop() {
    const stab = new OnetStabilizer(2, 1500);
    let frame = 0;
    grabRef.current ??= document.createElement('canvas');
    while (runRef.current) {
      if (pausedRef.current) { stab.reset(); setStatus('รอครูยืนยันด้านบนก่อน'); await new Promise((r) => setTimeout(r, 200)); continue; }
      const v = videoRef.current;
      const img = v ? videoFrame(v, grabRef.current) : null;
      if (!img) { await new Promise((r) => setTimeout(r, 100)); continue; }
      const { result } = await readOnet(reader, img, 'onet-camera', frame++);
      if (!runRef.current) break;
      overlay(result);
      const p = processRead(result, setsRef.current, cfg);
      if (p.kind === 'fail') { stab.push(null, performance.now()); setStatus(p.message); continue; }
      setStatus(`ชุดที่ ${p.setNo} · ${p.interp.seat.value ? `เลขที่ ${p.interp.seat.value}` : 'เลขที่ไม่ชัด'} — ถือนิ่ง ๆ`);
      const ok = stab.push(p, performance.now());
      if (!ok) continue;
      await onAccept(ok);
      setStatus('พร้อมแผ่นถัดไป');
    }
  }

  return (
    <section className="card scan-camera">
      {!on && (
        <div className="stack">
          <p>วางกระดาษคำตอบบนพื้นเรียบ ให้เห็นมุมดำครบ 4 มุม ระบบอ่านแล้วบันทึกเอง มีเสียง/สั่นเมื่อเสร็จแต่ละแผ่น</p>
          <div className="onet-tip"><Icon name="camera" /><span><b>ให้กระดาษเต็มจอ</b> (ถือมือถือแนวตั้ง ห่างพอให้เห็นมุมดำ 4 มุมพอดีขอบจอ) — กระดาษ A4 เล็กในภาพเกินไปจะอ่านวงไม่ชัด</span></div>
          <button className="btn big" onClick={start} data-testid="onet-camera-start"><Icon name="camera" /> เปิดกล้องเพื่อสแกน</button>
          {err && <div className="error" role="alert">{err}</div>}
          <p className="hint">ภาพจากกล้องไม่ถูกบันทึกหรือส่งขึ้นเซิร์ฟเวอร์ — ส่งเฉพาะคำตอบที่อ่านได้</p>
        </div>
      )}
      <div className={`video-box ${on ? '' : 'hidden'}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={overlayRef} />
      </div>
      {on && (
        <>
          <p className="scan-status" data-testid="onet-scan-status" aria-live="polite">{status || 'กำลังเริ่มกล้อง…'}</p>
          <div className="actions wrap">
            <button className="btn ghost" onClick={stop}>ปิดกล้อง</button>
            <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>กล้อง {res}</span>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- อัปโหลด
function Upload({ reader, sets, cfg, onAccept }: {
  reader: SheetReader; sets: OnetSetSummary[]; cfg: ScanConfig; onAccept: (r: Read, label: string) => Promise<{ text: string; kind: Done['kind'] }>;
}) {
  const [rows, setRows] = useState<Array<{ label: string; text: string; kind: Done['kind'] }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    unlockAudio();
    const out: typeof rows = [];
    const push = (r: (typeof rows)[number]) => { out.push(r); setRows([...out]); };
    for (const f of Array.from(files)) {
      try {
        for await (const pg of fileImages(f)) {
          setBusy(`กำลังอ่าน ${pg.label}`);
          const { result } = await readOnet(reader, pg.image, 'onet-upload');
          const p = processRead(result, sets, cfg);
          if (p.kind === 'fail') { push({ label: pg.label, text: p.message, kind: 'warn' }); continue; }
          push({ label: pg.label, ...(await onAccept(p, pg.label)) });
        }
      } catch (e) {
        push({ label: f.name, text: `เปิดไฟล์ไม่ได้: ${(e as Error).message}`, kind: 'warn' });
      }
    }
    setBusy(null);
  }

  return (
    <section className="card">
      <div className="stack">
        <p>เลือกภาพถ่ายกระดาษคำตอบ หรือไฟล์ PDF จากเครื่องสแกน (หลายไฟล์/หลายหน้าได้ · 1 แผ่นต่อภาพ)</p>
        <label className="btn file-btn">
          <Icon name="upload" /> เลือกไฟล์ภาพ/PDF
          <input type="file" accept="image/*,application/pdf,.pdf" multiple data-testid="onet-upload-input"
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} disabled={!!busy} />
        </label>
        <p className="hint">ไฟล์ถูกอ่านในเครื่องนี้เท่านั้น ไม่อัปโหลดภาพไปที่ใด</p>
      </div>
      {busy && <p className="sub" aria-live="polite">{busy}…</p>}
      {rows.length > 0 && (
        <ul className="upload-results" data-testid="onet-upload-results">
          {rows.map((r, i) => <li key={i} className={r.kind}><span className="label">{r.label}</span><span>{r.text}</span></li>)}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- ผลในห้อง
function Results({ roomId, closed, onChange }: { roomId: string; closed: boolean; onChange: () => void }) {
  const [data, setData] = useState<OnetReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => repo.onet.report(roomId).then(setData, (e) => setError((e as Error).message)), [roomId]);
  useEffect(() => { load(); }, [load]);
  if (error) return <div className="error" role="alert">{error}</div>;
  if (!data) return <p className="sub">กำลังโหลด…</p>;
  if (!data.results.length) return <p className="sub">ยังไม่มีผลในห้องนี้</p>;
  return (
    <>
      {data.sets.map((s) => {
        const rs = data.results.filter((r) => r.setCode === s.code);
        return (
          <section key={s.code} className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>ชุดที่ {s.setNo} · {rs.length} คน</h3>
            <div className="table-wrap">
              <table className="onet-items" data-testid={`onet-results-${s.code}`}>
                <thead><tr><th>เลขที่</th><th className="num">คะแนน</th><th>คำตอบ</th><th>หมายเหตุ</th><th></th></tr></thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.seatNo}>
                      <td>{r.seatNo}</td>
                      <td className="num"><b>{scoreText(r.score)}</b></td>
                      <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        {s.items.map((i) => (
                          <span key={i.itemNo} title={`ข้อ ${i.itemNo}`} className={r.correct[i.itemNo - 1] ? 'ok-text' : 'warn-text'}>
                            {r.correct[i.itemNo - 1] ? '✓' : answerLabel(r.answers[i.itemNo - 1], i.kind)}{' '}
                          </span>
                        ))}
                      </td>
                      <td className={r.remarks.length ? 'warn-text' : 'muted'}>{r.remarks.length ? r.remarks.map((m) => m.message).join(' · ') : '–'}</td>
                      <td>{!closed && <button className="btn ghost" aria-label={`ลบผลเลขที่ ${r.seatNo} ชุดที่ ${s.setNo}`}
                        onClick={async () => {
                          if (!confirm(`ลบผลเลขที่ ${r.seatNo} ชุดที่ ${s.setNo}? (สแกนใหม่ได้)`)) return;
                          try { await repo.onet.resultDelete(roomId, s.code, r.seatNo); await load(); onChange(); } catch (e) { setError((e as Error).message); }
                        }}><Icon name="trash" size={15} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
