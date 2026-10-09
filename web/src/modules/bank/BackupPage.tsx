// สำรองคลังเป็นไฟล์ JSON และนำเข้า (กู้คืน / เพิ่มข้อใหม่จากไฟล์) — SPEC §3.10, §12
import { useState } from 'react';
import { repo } from '../../data';
import type { ImportReport } from '../../core/types';
import { downloadJson, importTemplate, prepareImport, today, type PreparedImport } from './backup';
import { loadRefData } from './useRefData';

export function BackupPage() {
  const [includeSamples, setIncludeSamples] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);

  async function doExport() {
    setBusy(true); setError(null); setExported(null);
    try {
      const data = await repo.exportBank('MATH', includeSamples);
      downloadJson(data, `itembank-backup-${today()}.json`);
      setExported(`ดาวน์โหลดไฟล์สำรองแล้ว ${data.item_count.toLocaleString('th-TH')} ข้อ`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function onFile(file: File | undefined) {
    setPrepared(null); setPreview(null); setResult(null); setError(null);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const ref = await loadRefData();
      const p = prepareImport(await file.text(), { requireCheck: ref.settings['qa.require_answer_check'] === true });
      setPrepared(p);
      setPreview(await repo.importBank(p.doc, true));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function doImport() {
    if (!prepared) return;
    setBusy(true); setError(null);
    try { setResult(await repo.importBank(prepared.doc, false)); setPreview(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const report = result ?? preview;

  return (
    <>
      <h1>สำรองและนำเข้าคลัง</h1>
      <p className="sub">ไฟล์ JSON มาตรฐาน (itembank.bank.v1) เปิดอ่านได้ ไม่ผูกกับผู้ให้บริการรายใด</p>
      {error && <div className="error box" role="alert">{error}</div>}

      <section className="card stack">
        <h2>สำรองคลัง</h2>
        <p className="sub" style={{ margin: 0 }}>ได้ทุกข้อพร้อมทุกเวอร์ชัน เฉลย ผลตรวจ สถิติ และประวัติ — ควรเก็บไว้นอกระบบเป็นระยะ</p>
        <label className="check"><input type="checkbox" checked={includeSamples} onChange={(e) => setIncludeSamples(e.target.checked)} /> รวมข้อหุ่น</label>
        <div className="actions"><button className="btn" disabled={busy} onClick={doExport}>ดาวน์โหลดไฟล์สำรอง</button></div>
        {exported && <div className="notice" role="status">{exported}</div>}
      </section>

      <section className="card stack">
        <h2>นำเข้าจากไฟล์</h2>
        <ul className="sub" style={{ margin: 0, paddingLeft: 20 }}>
          <li>ข้อที่มีรหัสข้อ = กู้คืนตามไฟล์ (ถ้ารหัสนั้นมีในคลังแล้ว จะข้าม ไม่เขียนทับ)</li>
          <li>ข้อที่ไม่มีรหัสข้อ = ข้อใหม่ ได้รหัสใหม่และเข้าคลังเป็น "ร่าง" ให้ครูตรวจก่อนใช้</li>
          <li>ระบบตรวจคุณภาพอัตโนมัติให้ทุกข้อที่ยังไม่มีผลตรวจ และทดลองนำเข้าให้ดูก่อนเสมอ</li>
        </ul>
        <div className="actions wrap">
          <label className="btn ghost file-btn">
            เลือกไฟล์ JSON…
            <input type="file" accept=".json,application/json" aria-label="เลือกไฟล์นำเข้า" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <button className="btn ghost" onClick={() => downloadJson(importTemplate(), 'itembank-import-template.json')}>ดาวน์โหลดแม่แบบไฟล์นำเข้า</button>
        </div>
        {fileName && prepared && (
          <p className="sub" style={{ margin: 0 }}>
            ไฟล์ {fileName}: {prepared.itemCount.toLocaleString('th-TH')} รายการ
            {prepared.qaAdded > 0 && ` · ตรวจคุณภาพให้ ${prepared.qaAdded} เวอร์ชัน (ไม่ผ่าน ${prepared.qaFailed})`}
          </p>
        )}
        {report && (
          <div className="import-report" data-testid="import-report">
            <p><strong>{report.dryRun ? 'ผลการทดลองนำเข้า (ยังไม่บันทึก)' : 'นำเข้าเรียบร้อย'}</strong></p>
            <ul className="plain">
              <li data-testid="import-inserted">{report.dryRun ? 'จะเพิ่ม' : 'เพิ่มแล้ว'} {report.inserted} ข้อ</li>
              <li>ข้าม {report.skipped.length} ข้อ{report.skipped.length ? ' (มีรหัสนี้ในคลังแล้ว)' : ''}</li>
              <li className={report.errors.length ? 'warn-text' : ''}>ผิดพลาด {report.errors.length} ข้อ</li>
            </ul>
            {report.errors.length > 0 && (
              <ul className="qa-list">
                {report.errors.slice(0, 50).map((e) => (
                  <li key={e.index} className="qa-error">รายการที่ {e.index}{e.itemCode ? ` (${e.itemCode})` : ''}: {e.message}</li>
                ))}
              </ul>
            )}
            {report.dryRun && report.inserted > 0 && (
              <div className="actions">
                <button className="btn" disabled={busy} onClick={doImport}>นำเข้าจริง {report.inserted} ข้อ</button>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
