// หน้าตรวจกระดาษคำตอบ (SPEC §8): กล้องมือถือ (หลัก) · อัปโหลดภาพ/PDF (เสริม) · ผลตรวจและคิว remark
// ภาพจากกล้อง/ไฟล์ถูกอ่านในเครื่องนี้แล้วทิ้งทันที ส่งขึ้นเซิร์ฟเวอร์เฉพาะคำตอบที่อ่านได้รายเลขที่
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { repo } from '../../data';
import type { ExamDetail, ScanResponse, ScanSaveResult, ScanSource } from '../../core/types';
import type { Route } from '../../ui/router';
import { navigate } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { scanConfigFromSettings, DEFAULT_SCAN, type ScanConfig } from './grade';
import { FAIL_TH, type ReadResult } from './omr';
import { SheetReader } from './reader';
import { isProposal, Stabilizer, toProposal, type Proposal } from './session';
import { fileImages, videoFrame } from './sources';
import { feedback, unlockAudio } from './feedback';
import { ReviewPanel } from './ReviewPanel';

type Tab = 'camera' | 'upload' | 'results';

export interface Conflict { proposal: Proposal; source: ScanSource; old: ScanResponse; newScore: number }

export function openRemarks(r: ScanResponse) { return r.flags.filter((f) => !f.resolved); }

export function ScanPage({ id, route }: { id: string; route: Route }) {
  const { data: ref } = useRefData();
  const [exam, setExam] = useState<ExamDetail | null | undefined>(undefined);
  const [cfg, setCfg] = useState<ScanConfig>(DEFAULT_SCAN);
  const [scans, setScans] = useState<ScanResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const tab = (route.params.get('tab') as Tab) || 'camera';
  const reviewSeat = Number(route.params.get('seat')) || null;
  const reader = useMemo(() => new SheetReader(), []);
  useEffect(() => () => reader.dispose(), [reader]);

  const reload = useCallback(() => repo.listScans(id).then(setScans, (e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    repo.getExam(id).then(setExam, (e) => setError((e as Error).message));
    repo.getSettings().then((s) => setCfg(scanConfigFromSettings(s)), () => {});
    reload();
  }, [id, reload]);

  /** บันทึกผลตรวจ — ใช้ร่วมกันทั้งกล้องและอัปโหลด */
  const save = useCallback(async (p: Proposal, source: ScanSource, replace = false): Promise<ScanSaveResult> => {
    const r = await repo.saveScan({ examId: p.examId, seatNo: p.seatNo, setNo: p.setNo, answers: p.answers, ambiguous: p.ambiguous, source, replace });
    if (r.status === 'exists') {
      setConflicts((cs) => [...cs.filter((c) => c.proposal.seatNo !== p.seatNo), { proposal: p, source, old: r.response, newScore: r.newScore ?? p.localScore }]);
    } else {
      setScans((list) => [...list.filter((x) => x.seatNo !== r.response.seatNo), r.response].sort((a, b) => a.seatNo - b.seatNo));
      if (r.status === 'saved') setExam((e) => (e && e.status === 'draft' ? { ...e, status: 'open', hasResponses: true } : e));
    }
    return r;
  }, []);

  async function resolveConflict(c: Conflict, useNew: boolean) {
    setConflicts((cs) => cs.filter((x) => x !== c));
    if (useNew) { try { await save(c.proposal, c.source, true); } catch (e) { setError((e as Error).message); } }
  }

  if (error && exam === undefined) return <div className="error" role="alert">{error}</div>;
  if (exam === undefined) return <p className="sub">กำลังโหลด…</p>;
  if (exam === null) return <div className="card">ไม่พบชุดข้อสอบนี้ · <a href="#/exams">กลับไปรายการชุดข้อสอบ</a></div>;

  const grade = ref?.grades.find((g) => g.id === exam.gradeId)?.shortTh ?? exam.gradeId;
  const remarkCount = scans.filter((s) => openRemarks(s).length).length;
  const closed = exam.status === 'closed' || exam.status === 'expired';
  const setTab = (t: Tab) => navigate(`/exams/${id}/scan`, { tab: t }, true);
  const review = reviewSeat ? scans.find((s) => s.seatNo === reviewSeat) ?? null : null;

  return (
    <>
      <div className="crumb"><a href="#/exams">ชุดข้อสอบ</a> › <a href={`#/exams/${exam.id}`}>{exam.title}</a> › ตรวจ</div>
      <div className="page-head">
        <div>
          <h1>ตรวจกระดาษคำตอบ</h1>
          <p className="sub" data-testid="scan-meta">{exam.title} · {grade} · {exam.itemCount} ข้อ · {exam.setCount} ชุด</p>
        </div>
      </div>
      <div className="scan-progress" data-testid="scan-progress">
        <span className="counter ok">ตรวจแล้ว {scans.length}/{exam.studentCount}</span>
        {remarkCount > 0 && <button className="counter under link-like" onClick={() => navigate(`/exams/${id}/scan`, { tab: 'results', remark: 1 }, true)}>remark {remarkCount} แผ่น</button>}
      </div>
      {closed && <div className="error box" role="alert">ชุดข้อสอบนี้ปิดแล้ว ตรวจเพิ่มไม่ได้</div>}
      {error && <div className="error box" role="alert">{error} <button className="link" onClick={() => setError(null)}>ปิด</button></div>}

      {conflicts.map((c) => (
        <div key={c.proposal.seatNo} className="conflict" role="alert" data-testid="conflict">
          <p><b>เลขที่ {c.proposal.seatNo} ตรวจไปแล้ว</b> — ผลเดิม {c.old.score}/{exam.itemCount} · ผลใหม่ {c.newScore}/{exam.itemCount}</p>
          <div className="actions wrap">
            <button className="btn" onClick={() => resolveConflict(c, true)}>ใช้ผลใหม่</button>
            <button className="btn ghost" onClick={() => resolveConflict(c, false)}>คงผลเดิม</button>
          </div>
        </div>
      ))}

      <div className="tabs" role="group" aria-label="วิธีตรวจ">
        <button aria-pressed={tab === 'camera'} onClick={() => setTab('camera')}>กล้อง</button>
        <button aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>อัปโหลดภาพ/PDF</button>
        <button aria-pressed={tab === 'results'} onClick={() => setTab('results')}>ผลตรวจ ({scans.length})</button>
      </div>

      {tab === 'camera' && !closed && <CameraScanner exam={exam} cfg={cfg} reader={reader} save={save} onError={setError} />}
      {tab === 'upload' && !closed && <UploadScanner exam={exam} cfg={cfg} reader={reader} save={save} />}
      {tab === 'results' && (
        review
          ? <ReviewPanel exam={exam} response={review} closed={closed}
              onDone={(r) => { if (r) setScans((l) => l.map((x) => (x.seatNo === r.seatNo ? r : x))); else reload(); navigate(`/exams/${id}/scan`, { tab: 'results' }, true); }} />
          : <ResultsTable exam={exam} scans={scans} onlyRemarks={route.params.get('remark') === '1'} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- กล้อง
interface LastResult { kind: 'ok' | 'remark' | 'dup' | 'warn'; title: string; detail?: string; at: number }

function CameraScanner({ exam, cfg, reader, save, onError }: {
  exam: ExamDetail; cfg: ScanConfig; reader: SheetReader; save: (p: Proposal, s: ScanSource) => Promise<ScanSaveResult>; onError: (m: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(false);
  const warnRef = useRef<{ msg: string; at: number }>({ msg: '', at: 0 });
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState('');
  const [last, setLast] = useState<LastResult | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [fps, setFps] = useState(0);

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
    if (!navigator.mediaDevices?.getUserMedia) { onError('อุปกรณ์/เบราว์เซอร์นี้เปิดกล้องในหน้าเว็บไม่ได้ — ใช้แท็บ "อัปโหลดภาพ/PDF" แทน'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as any;
      setTorch(caps.torch ? false : null);
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setOn(true);
      runRef.current = true;
      loop();
    } catch (e) {
      onError(`เปิดกล้องไม่ได้: ${(e as Error).message} — ตรวจว่าอนุญาตให้เว็บนี้ใช้กล้องแล้ว`);
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { setTorch(null); }
  }

  function drawOverlay(r: ReadResult | null) {
    const c = overlayRef.current, v = videoRef.current;
    if (!c || !v) return;
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!r || !r.ok) return;
    const [tl, tr, bl, br] = r.corners;
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = Math.max(4, c.width / 250);
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y); ctx.closePath();
    ctx.stroke();
  }

  async function loop() {
    const stab = new Stabilizer(2, 1500);
    let frame = 0, t0 = performance.now(), n = 0;
    grabRef.current ??= document.createElement('canvas');
    while (runRef.current) {
      const v = videoRef.current;
      const img = v ? videoFrame(v, grabRef.current) : null;
      if (!img) { await new Promise((r) => setTimeout(r, 100)); continue; }
      const { results } = await reader.read(img, 'camera', frame++);
      if (!runRef.current) break;
      n++;
      if (performance.now() - t0 > 2000) { setFps(Math.round((n * 10000) / (performance.now() - t0)) / 10); t0 = performance.now(); n = 0; }
      const r = results[0] ?? null;
      drawOverlay(r);
      if (!r || !r.ok) {
        stab.push(null, performance.now());
        setStatus(r ? FAIL_TH[r.reason] : FAIL_TH.no_qr);
        continue;
      }
      const p = toProposal(r, exam, cfg);
      if (!isProposal(p)) {
        stab.push(null, performance.now());
        setStatus(p.message);
        // เตือนครั้งเดียวต่อเรื่อง (ไม่ส่งเสียงซ้ำทุกเฟรม)
        if (warnRef.current.msg !== p.message || performance.now() - warnRef.current.at > 4000) {
          feedback('warn');
          setLast({ kind: 'warn', title: p.message, at: performance.now() });
        }
        warnRef.current = { msg: p.message, at: performance.now() };
        continue;
      }
      setStatus(`กำลังอ่านเลขที่ ${p.seatNo} — ถือนิ่ง ๆ`);
      const accepted = stab.push(p, performance.now());
      if (!accepted) continue;
      try {
        const res = await save(accepted, 'camera');
        const sc = `${res.status === 'exists' ? res.newScore : res.response.score}/${exam.itemCount}`;
        if (res.status === 'unchanged') {
          feedback('warn');
          setLast({ kind: 'dup', title: `เลขที่ ${accepted.seatNo} สแกนซ้ำ`, detail: `ตรวจไปแล้ว ได้ ${res.response.score}/${exam.itemCount} (ผลเดิม)`, at: performance.now() });
        } else if (res.status === 'exists') {
          feedback('warn');
          setLast({ kind: 'dup', title: `เลขที่ ${accepted.seatNo} ตรวจไปแล้ว แต่ผลต่างจากเดิม`, detail: 'เลือก "ใช้ผลใหม่" หรือ "คงผลเดิม" ด้านบน', at: performance.now() });
        } else {
          const rem = openRemarks(res.response);
          feedback(rem.length ? 'remark' : 'ok');
          setLast({ kind: rem.length ? 'remark' : 'ok', title: `เลขที่ ${accepted.seatNo} · ชุด ${accepted.setNo} · ${sc}`,
            detail: rem.length ? remarkText(rem) : 'บันทึกแล้ว — พลิกแผ่นถัดไป', at: performance.now() });
        }
        setStatus('พร้อมแผ่นถัดไป');
      } catch (e) {
        feedback('warn');
        setLast({ kind: 'warn', title: `บันทึกเลขที่ ${accepted.seatNo} ไม่สำเร็จ`, detail: (e as Error).message, at: performance.now() });
        stab.reset();
      }
    }
  }

  return (
    <section className="card scan-camera">
      {!on && (
        <div className="stack">
          <p>วางกระดาษคำตอบบนพื้นเรียบ ให้เห็นมุมดำครบ 4 มุม ระบบอ่านแล้วบันทึกให้เอง มีเสียง/สั่นเมื่อเสร็จแต่ละแผ่น</p>
          <button className="btn big" onClick={start} data-testid="camera-start">เปิดกล้องเพื่อตรวจ</button>
          <p className="hint">ภาพจากกล้องไม่ถูกบันทึกหรือส่งขึ้นเซิร์ฟเวอร์ — ส่งเฉพาะคำตอบที่อ่านได้</p>
        </div>
      )}
      <div className={`video-box ${on ? '' : 'hidden'}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={overlayRef} />
      </div>
      {on && (
        <>
          <p className="scan-status" data-testid="scan-status" aria-live="polite">{status || 'กำลังเริ่มกล้อง…'}</p>
          {last && (
            <div className={`scan-last ${last.kind}`} data-testid="scan-last">
              <b>{last.title}</b>{last.detail && <span>{last.detail}</span>}
            </div>
          )}
          <div className="actions wrap">
            <button className="btn ghost" onClick={stop}>ปิดกล้อง</button>
            {torch !== null && <button className="btn ghost" onClick={toggleTorch}>{torch ? 'ปิดไฟฉาย' : 'เปิดไฟฉาย'}</button>}
            <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>{fps ? `${fps} ภาพ/วินาที` : ''}</span>
          </div>
        </>
      )}
    </section>
  );
}

export function remarkText(flags: ScanResponse['flags']): string {
  return flags.map((f) => (f.type === 'ambiguous'
    ? `ข้อ ${f.positions.join(', ')} อ่านไม่ชัด`
    : `สงสัยแจกผิดชุด (ตรวจด้วยชุด ${f.suggested_set} ได้ ${f.score_alt})`)).join(' · ') + ' — ดูกระดาษจริงแล้วยืนยันในแท็บผลตรวจ';
}

// ---------------------------------------------------------------- อัปโหลด
interface UploadRow { label: string; ok: boolean; text: string; kind: 'ok' | 'remark' | 'dup' | 'warn' }

function UploadScanner({ exam, cfg, reader, save }: {
  exam: ExamDetail; cfg: ScanConfig; reader: SheetReader; save: (p: Proposal, s: ScanSource) => Promise<ScanSaveResult>;
}) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    unlockAudio();
    const out: UploadRow[] = [];
    const push = (r: UploadRow) => { out.push(r); setRows([...out]); };
    for (const f of Array.from(files)) {
      try {
        for await (const pg of fileImages(f)) {
          setBusy(`กำลังอ่าน ${pg.label}`);
          const { results } = await reader.read(pg.image, 'upload');
          const label = (i: number) => (results.length > 1 ? `${pg.label} (แผ่น${i === 0 ? 'ซ้าย/บน' : 'ขวา/ล่าง'})` : pg.label);
          for (const [i, r] of results.entries()) {
            if (!r.ok) {
              // ครึ่งหน้าที่ว่าง (พิมพ์แผ่นเดียว) ไม่ต้องแจ้ง
              if (results.length > 1 && r.reason === 'no_qr') continue;
              push({ label: label(i), ok: false, text: r.message, kind: 'warn' });
              continue;
            }
            const p = toProposal(r, exam, cfg);
            if (!isProposal(p)) { push({ label: label(i), ok: false, text: p.message, kind: 'warn' }); continue; }
            try {
              const res = await save(p, 'upload');
              if (res.status === 'unchanged') push({ label: label(i), ok: true, text: `เลขที่ ${p.seatNo}: สแกนซ้ำ (ผลเดิม ${res.response.score}/${exam.itemCount})`, kind: 'dup' });
              else if (res.status === 'exists') push({ label: label(i), ok: true, text: `เลขที่ ${p.seatNo}: ตรวจไปแล้วแต่ผลต่างจากเดิม — เลือกด้านบน`, kind: 'dup' });
              else {
                const rem = openRemarks(res.response);
                push({ label: label(i), ok: true, kind: rem.length ? 'remark' : 'ok',
                  text: `เลขที่ ${p.seatNo} · ชุด ${p.setNo} · ${res.response.score}/${exam.itemCount}${rem.length ? ` · ${remarkText(rem)}` : ''}` });
              }
            } catch (e) {
              push({ label: label(i), ok: false, text: (e as Error).message, kind: 'warn' });
            }
          }
        }
      } catch (e) {
        push({ label: f.name, ok: false, text: `เปิดไฟล์ไม่ได้: ${(e as Error).message}`, kind: 'warn' });
      }
    }
    setBusy(null);
    feedback(out.some((r) => r.kind === 'warn' || r.kind === 'dup') ? 'warn' : out.some((r) => r.kind === 'remark') ? 'remark' : 'ok');
  }

  return (
    <section className="card">
      <div className="stack">
        <p>เลือกภาพถ่ายกระดาษคำตอบ หรือไฟล์ PDF จากเครื่องสแกน (หลายหน้าได้ · กระดาษ A4 ที่ยังไม่ตัดครึ่งก็ได้)</p>
        <label className="btn file-btn">
          เลือกไฟล์ภาพ/PDF
          <input type="file" accept="image/*,application/pdf,.pdf" multiple data-testid="upload-input"
            onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} disabled={!!busy} />
        </label>
        <p className="hint">ไฟล์ถูกอ่านในเครื่องนี้เท่านั้น ไม่อัปโหลดภาพไปที่ใด</p>
      </div>
      {busy && <p className="sub" aria-live="polite">{busy}…</p>}
      {rows.length > 0 && (
        <ul className="upload-results" data-testid="upload-results">
          {rows.map((r, i) => <li key={i} className={r.kind}><span className="label">{r.label}</span><span>{r.text}</span></li>)}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- ผลตรวจ
function ResultsTable({ exam, scans, onlyRemarks }: { exam: ExamDetail; scans: ScanResponse[]; onlyRemarks: boolean }) {
  const bySeat = new Map(scans.map((s) => [s.seatNo, s]));
  const missing = exam.seats.filter((s) => !bySeat.has(s.seatNo)).map((s) => s.seatNo);
  const rows = exam.seats.filter((s) => !onlyRemarks || (bySeat.get(s.seatNo) && openRemarks(bySeat.get(s.seatNo)!).length));
  const avg = scans.length ? scans.reduce((a, s) => a + s.score, 0) / scans.length : null;
  return (
    <section className="card">
      <div className="builder-counter">
        <span>ตรวจแล้ว <b>{scans.length}</b> จาก {exam.studentCount} คน</span>
        {avg !== null && <span>คะแนนเฉลี่ย <b>{avg.toFixed(1)}</b>/{exam.itemCount}</span>}
        <label className="check"><input type="checkbox" checked={onlyRemarks}
          onChange={(e) => navigate(`/exams/${exam.id}/scan`, { tab: 'results', remark: e.target.checked ? 1 : undefined }, true)} /> เฉพาะที่มี remark</label>
      </div>
      {missing.length > 0 && !onlyRemarks && <p className="sub" data-testid="missing-seats">ยังไม่ตรวจ: เลขที่ {compactRanges(missing)}</p>}
      <div className="table-wrap">
        <table className="set-table scan-table" data-testid="scan-table">
          <thead><tr><th>เลขที่</th><th>ชุด</th><th>คะแนน</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => {
              const r = bySeat.get(s.seatNo);
              const rem = r ? openRemarks(r) : [];
              return (
                <tr key={s.seatNo} className={rem.length ? 'has-remark' : ''}>
                  <td>{s.seatNo}</td>
                  <td>{r ? r.setNo : s.setNo}{r && r.setNo !== s.setNo ? ' *' : ''}</td>
                  <td>{r ? `${r.score}/${exam.itemCount}` : '–'}</td>
                  <td>{!r ? <span className="muted">ยังไม่ตรวจ</span> : rem.length ? <span className="warn-text">remark: {remarkShort(rem)}</span> : <span className="ok-text">✓ {r.source === 'upload' ? 'ไฟล์' : r.source === 'manual' ? 'แก้มือ' : 'กล้อง'}</span>}</td>
                  <td>{r && <a href={`#/exams/${exam.id}/scan?tab=results&seat=${s.seatNo}`}>{rem.length ? 'ตรวจทาน' : 'ดู/แก้'}</a>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="empty">ไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">* ตรวจด้วยชุดอื่นจากที่กำหนดให้เลขที่นั้น (ครูยืนยันว่าแจกผิดชุด)</p>
    </section>
  );
}

function remarkShort(flags: ScanResponse['flags']) {
  return flags.map((f) => (f.type === 'ambiguous' ? `ข้อ ${f.positions.join(', ')}` : `ผิดชุด?`)).join(' · ');
}

export function compactRanges(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j > i + 1 ? `${ns[i]}–${ns[j]}` : j === i + 1 ? `${ns[i]}, ${ns[j]}` : `${ns[i]}`);
    i = j;
  }
  return out.join(', ');
}

