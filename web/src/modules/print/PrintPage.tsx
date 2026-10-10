// หน้าเอกสารพิมพ์ของชุดข้อสอบ: เลือกเอกสาร (แบบทดสอบรายชุด / เฉลยครู / กระดาษคำตอบ)
// → "พิมพ์ / บันทึก PDF" (หน้าต่างพิมพ์ของเบราว์เซอร์) หรือดาวน์โหลด Word
import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { repo } from '../../data';
import type { ExamDetail } from '../../core/types';
import { navigate, type Route } from '../../ui/router';
import { useRefData } from '../core/useRefData';
import { buildPrintDoc, type PrintDoc } from './model';
import { ExamPrint, KeyPrint, SheetsPrint } from './PrintViews';
import { buildExamDocx, buildKeyDocx, safeName, toBlob, type Rasterize } from './docx';
import { sampleExam } from './sampleDoc';
import './print.css';
import thai400 from '@fontsource/sarabun/files/sarabun-thai-400-normal.woff2?url';
import thai700 from '@fontsource/sarabun/files/sarabun-thai-700-normal.woff2?url';
import latin400 from '@fontsource/sarabun/files/sarabun-latin-400-normal.woff2?url';
import latin700 from '@fontsource/sarabun/files/sarabun-latin-700-normal.woff2?url';

// ฟอนต์สำรองเมื่อเครื่องไม่มี TH Sarabun New: Sarabun ย่อขนาดให้ใกล้เคียง TH Sarabun New ที่ขนาดพอยต์เดียวกัน
const FONT_FACES = [[thai400, 400, 'U+0E01-0E5B, U+200C-200D, U+25CC'], [thai700, 700, 'U+0E01-0E5B, U+200C-200D, U+25CC'],
  [latin400, 400, 'U+0000-00FF, U+2000-206F, U+2190-22FF, U+2460-24FF'], [latin700, 700, 'U+0000-00FF, U+2000-206F, U+2190-22FF, U+2460-24FF']]
  .map(([src, w, range]) => `@font-face{font-family:'PrintThai';src:url(${src}) format('woff2');font-weight:${w};size-adjust:72%;unicode-range:${range};}`)
  .join('');

export const rasterizeInBrowser: Rasterize = (svg, width, height) => new Promise((resolve, reject) => {
  const scale = 3;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(width * scale); c.height = Math.ceil(height * scale);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('แปลงรูปไม่สำเร็จ'))), 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('โหลดรูปไม่สำเร็จ')); };
  img.src = url;
});

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

type Tab = 'exam' | 'key' | 'sheets';

export function PrintPage({ id, route }: { id: string | null; route: Route }) {
  const { data: ref, error: refError } = useRefData();
  const [exam, setExam] = useState<ExamDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [saved, setSaved] = useState(false);
  const tab = (route.params.get('doc') as Tab) || 'exam';
  const setNo = Number(route.params.get('set') ?? 1);
  const isSample = id === null;

  useEffect(() => {
    if (isSample) { if (ref) setExam(sampleExam(ref)); return; }
    repo.getExam(id!).then(setExam, (e) => setError((e as Error).message));
  }, [id, isSample, ref]);
  useEffect(() => { if (exam) { setTitle(exam.title); setMinutes(exam.durationMin ? String(exam.durationMin) : ''); } }, [exam]);

  const built = useMemo((): { doc: PrintDoc | null; err: string | null } => {
    if (!exam || !ref) return { doc: null, err: null };
    try { return { doc: buildPrintDoc(exam, ref, { figureNote: String(ref.settings['print.figure_note'] ?? '') || undefined }), err: null }; }
    catch (e) { return { doc: null, err: (e as Error).message }; }
  }, [exam, ref]);
  const doc = built.doc;

  if (built.err || refError) return <div className="error" role="alert">{built.err || refError}</div>;
  if (exam === null) return <div className="card">ไม่พบชุดข้อสอบนี้ · <a href="#/exams">กลับไปรายการชุดข้อสอบ</a></div>;
  if (!doc || !exam) return <p className="sub">กำลังเตรียมเอกสาร…</p>;
  const set = doc.sets.find((s) => s.setNo === setNo) ?? doc.sets[0];
  const go = (params: Record<string, string | number | undefined>) =>
    navigate(isSample ? '/dev/print-sample' : `/exams/${id}/print`, { doc: tab, set: set.setNo, ...params }, true);

  async function saveMeta() {
    setBusy('meta'); setError(null); setSaved(false);
    try {
      await repo.updateExamMeta(exam!.id, title, Number(minutes));
      setExam(await repo.getExam(exam!.id));
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  async function wordSet() {
    setBusy('word');
    try { download(await toBlob(await buildExamDocx(doc!, set, rasterizeInBrowser)), `${safeName(doc!.title)}_ชุดที่${set.setNo}.docx`); }
    catch (e) { setError((e as Error).message); }
    setBusy(null);
  }
  async function wordKey() {
    setBusy('key');
    try { download(await toBlob(buildKeyDocx(doc!)), `${safeName(doc!.title)}_เฉลยครู.docx`); } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }
  async function wordAll() {
    setBusy('zip');
    try {
      const zip = new JSZip();
      for (const s of doc!.sets) zip.file(`${safeName(doc!.title)}_ชุดที่${s.setNo}.docx`, await toBlob(await buildExamDocx(doc!, s, rasterizeInBrowser)));
      zip.file(`${safeName(doc!.title)}_เฉลยครู.docx`, await toBlob(buildKeyDocx(doc!)));
      download(await zip.generateAsync({ type: 'blob' }), `${safeName(doc!.title)}_Word_ทุกชุด.zip`);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  const metaDirty = title.trim() !== exam.title || Number(minutes) !== exam.durationMin;
  return (
    <>
      <style>{FONT_FACES}</style>
      {error && <div className="error box no-print" role="alert">{error}</div>}
      <div className="no-print">
        <div className="crumb">
          <a href="#/exams">ชุดข้อสอบ</a> › {isSample ? 'ตัวอย่างเอกสาร' : <a href={`#/exams/${exam.id}`}>{exam.title}</a>} › เอกสารพิมพ์
        </div>
        <h1>เอกสารพิมพ์</h1>
        {isSample && <div className="banner">ตัวอย่างเอกสารจากข้อสอบจำลอง (โหมดสาธิต)</div>}

        {!isSample && (
          <section className="card print-meta">
            <div className="field-grid">
              <label className="wide">ชื่อแบบทดสอบ (หัวกระดาษ)
                <input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} />
              </label>
              <label>เวลาสอบ (นาที)
                <input type="number" inputMode="numeric" min={1} max={300} value={minutes} onChange={(e) => { setMinutes(e.target.value); setSaved(false); }} />
              </label>
            </div>
            <div className="actions">
              <button className="btn ghost" disabled={!metaDirty || busy !== null} onClick={saveMeta}>{busy === 'meta' ? 'กำลังบันทึก…' : 'บันทึกหัวกระดาษ'}</button>
              {saved && <span className="ok-text" role="status">บันทึกแล้ว</span>}
            </div>
          </section>
        )}

        <div className="tabs" role="group" aria-label="เลือกเอกสาร">
          <button aria-pressed={tab === 'exam'} onClick={() => go({ doc: 'exam' })}>แบบทดสอบ</button>
          <button aria-pressed={tab === 'key'} onClick={() => go({ doc: 'key' })}>เฉลยครู</button>
          <button aria-pressed={tab === 'sheets'} onClick={() => go({ doc: 'sheets' })}>กระดาษคำตอบ</button>
        </div>
        {tab === 'exam' && (
          <div className="tabs" role="group" aria-label="เลือกชุด">
            {doc.sets.map((s) => <button key={s.setNo} aria-pressed={s.setNo === set.setNo} onClick={() => go({ set: s.setNo })}>ชุดที่ {s.setNo}</button>)}
          </div>
        )}
        <div className="actions wrap">
          <button className="btn" onClick={() => window.print()}>พิมพ์ / บันทึก PDF</button>
          {tab === 'exam' && <button className="btn ghost" disabled={busy !== null} onClick={wordSet}>{busy === 'word' ? 'กำลังสร้าง…' : `Word ชุดที่ ${set.setNo}`}</button>}
          {tab === 'key' && <button className="btn ghost" disabled={busy !== null} onClick={wordKey}>{busy === 'key' ? 'กำลังสร้าง…' : 'Word เฉลยครู'}</button>}
          {tab !== 'sheets' && <button className="btn ghost" disabled={busy !== null} onClick={wordAll}>{busy === 'zip' ? 'กำลังสร้าง…' : 'Word ทุกชุด + เฉลย (.zip)'}</button>}
        </div>
        <p className="hint-line print-hint">
          {tab === 'sheets'
            ? `กระดาษคำตอบ ${doc.seats.length} แผ่น (A4 แนวนอน ${Math.ceil(doc.seats.length / 2)} หน้า ตัดครึ่งได้ A5) — ตอนพิมพ์ให้ตั้ง "สเกล 100% / ขนาดจริง" ห้ามย่อหรือขยาย เพื่อให้ตรวจด้วยกล้องได้แม่นยำ`
            : 'บันทึกเป็น PDF: กด "พิมพ์ / บันทึก PDF" แล้วเลือกปลายทาง "บันทึกเป็น PDF" · กระดาษ A4 · ระบบใช้ฟอนต์ TH Sarabun New ถ้าเครื่องมีติดตั้ง'}
        </p>
      </div>
      <div className="print-stage" data-testid="print-stage">
        {tab === 'exam' && <ExamPrint doc={doc} set={set} />}
        {tab === 'key' && <KeyPrint doc={doc} />}
        {tab === 'sheets' && <SheetsPrint doc={doc} />}
      </div>
    </>
  );
}
