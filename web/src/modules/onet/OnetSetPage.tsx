// หน้าชุดติว O-NET: ดาวน์โหลดไฟล์ · เปิดสไลด์เฉลยในแอป · พิมพ์กระดาษคำตอบ · รายการข้อ (ตัวชี้วัด/แม่แบบ)
// ชุดที่ล็อก: เห็นหัวข้อของแต่ละข้อ แต่ไม่มีไฟล์/วิธีคิด/กับดัก (เซิร์ฟเวอร์ไม่ส่งมา)
import { useEffect, useMemo, useRef, useState } from 'react';
import { repo } from '../../data';
import { href } from '../../ui/router';
import { onetSheetSvg } from '../print/onetSheetSvg';
import { getOnetTemplate, ONET_CURRENT_TEMPLATE } from '../print/onetTemplate';
import { download } from '../analysis/ReportPage';
import { Icon } from './Icon';
import { LockPanel, SetTag, useOnetCatalog } from './OnetHomePage';
import { ONET_FILES, type OnetFileKind, type OnetSetDetail } from './types';
import thai400 from '@fontsource/sarabun/files/sarabun-thai-400-normal.woff2?url';
import thai700 from '@fontsource/sarabun/files/sarabun-thai-700-normal.woff2?url';
import latin400 from '@fontsource/sarabun/files/sarabun-latin-400-normal.woff2?url';
import latin700 from '@fontsource/sarabun/files/sarabun-latin-700-normal.woff2?url';
import './onet.css';

function useSet(code: string) {
  const [set, setSet] = useState<OnetSetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { repo.onet.setDetail(code).then(setSet, (e) => setError((e as Error).message)); }, [code]);
  return { set, error };
}

export function OnetSetPage({ code, email }: { code: string; email: string | null }) {
  const { set, error } = useSet(code);
  const { cat } = useOnetCatalog();
  const [busy, setBusy] = useState<OnetFileKind | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function get(kind: OnetFileKind) {
    if (!set) return;
    setBusy(kind); setMsg(null);
    try {
      const b = await repo.onet.file(code, kind);
      if (!b) setMsg(`ยังไม่มีไฟล์${ONET_FILES[kind].label} — ผู้ดูแลยังไม่ได้อัปโหลด`);
      else download(b, ONET_FILES[kind].download(set.setNo), b.type);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  }

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!set) return <p className="sub">กำลังโหลด…</p>;
  return (
    <>
      <div className="crumb"><a href={href('/onet')}>ห้อง O-NET</a> › ชุดที่ {set.setNo}</div>
      <div className="page-head">
        <div>
          <h1>ชุดที่ {set.setNo} <SetTag isFree={set.isFree} usable={set.usable} /></h1>
          <p className="sub" data-testid="set-meta">{set.title} · {set.items.length} ข้อ · รหัสชุดข้อสอบ {set.bubbleCode}</p>
        </div>
      </div>
      {set.usable ? (
        <div className="card">
          <div className="onet-actions" data-testid="set-actions">
            <button className="btn" onClick={() => get('exam')} disabled={!!busy}><Icon name="download" />{busy === 'exam' ? 'กำลังโหลด…' : ONET_FILES.exam.label}</button>
            <a className="btn" href={href(`/onet/sets/${code}/sheet`)}><Icon name="print" />พิมพ์กระดาษคำตอบ</a>
            <a className="btn ghost icon-btn" href={href(`/onet/sets/${code}/slides`)}><Icon name="play" />เปิดสไลด์เฉลย</a>
            <button className="btn ghost icon-btn" onClick={() => get('key')} disabled={!!busy}><Icon name="download" />{busy === 'key' ? 'กำลังโหลด…' : ONET_FILES.key.label}</button>
            <a className="btn ghost icon-btn" href={href('/onet/rooms')}><Icon name="camera" />สแกน</a>
          </div>
          {msg && <div className="error" role="alert">{msg}</div>}
          <p className="hint" style={{ marginTop: 4 }}>ข้อสอบใน PDF มีกระดาษคำตอบหน้าสุดท้ายอยู่แล้ว · กระดาษคำตอบ A4 ทุกแผ่นของชุดเดียวกันเหมือนกัน ถ่ายเอกสารได้ (ย่อ A5 ก็สแกนได้)</p>
        </div>
      ) : cat && <LockPanel cat={cat} email={email} />}

      <h2 style={{ marginTop: 20 }}>เนื้อหาแต่ละข้อ</h2>
      <div className="table-wrap">
        <table className="onet-items" data-testid="set-items">
          <thead><tr><th>ข้อ</th><th>ตัวชี้วัด</th><th>แม่แบบ</th><th className="num">คะแนน</th><th>ควรเน้น</th>{set.usable && <th>วิธีคิด / กับดัก</th>}</tr></thead>
          <tbody>
            {set.items.map((i) => (
              <tr key={i.itemNo}>
                <td>{i.itemNo}{i.kind === 'numeric3' ? <span className="muted"> (ระบาย)</span> : ''}</td>
                <td>{i.indicatorCode}</td>
                <td>{i.topic}</td>
                <td className="num">{i.points}</td>
                <td>{i.focus ?? <span className="muted">–</span>}</td>
                {set.usable && <td>{i.solution}{i.traps && <div className="muted">กับดัก: {i.traps}</div>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** สไลด์เฉลยในแอป (HTML จาก Storage) — เปิดใน iframe ที่รันสคริปต์ได้แต่แยกจากเว็บหลัก */
export function OnetSlidesPage({ code }: { code: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    repo.onet.file(code, 'slides').then(
      async (b) => (b ? setHtml(await b.text()) : setError('ยังไม่มีสไลด์เฉลยของชุดนี้ — ผู้ดูแลยังไม่ได้อัปโหลด')),
      (e) => setError((e as Error).message));
  }, [code]);
  return (
    <>
      <div className="crumb"><a href={href('/onet')}>ห้อง O-NET</a> › <a href={href(`/onet/sets/${code}`)}>ชุดที่ {Number(code.slice(1))}</a> › สไลด์เฉลย</div>
      <div className="page-head">
        <h1 style={{ margin: '0 0 8px' }}>สไลด์เฉลย ชุดที่ {Number(code.slice(1))}</h1>
        {html && <button className="btn" onClick={() => frame.current?.requestFullscreen?.()}><Icon name="play" /> เต็มจอ</button>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!html && !error && <p className="sub">กำลังโหลด…</p>}
      {html && <iframe ref={frame} className="slides-frame" title="สไลด์เฉลย" sandbox="allow-scripts" srcDoc={html} allowFullScreen data-testid="slides-frame" />}
    </>
  );
}

const FONT_CSS = [[thai400, 400, 'U+0E01-0E5B, U+200C-200D, U+25CC'], [thai700, 700, 'U+0E01-0E5B, U+200C-200D, U+25CC'],
  [latin400, 400, 'U+0000-00FF, U+2000-206F, U+2190-22FF, U+2460-24FF'], [latin700, 700, 'U+0000-00FF, U+2000-206F, U+2190-22FF, U+2460-24FF']]
  .map(([src, w, range]) => `@font-face{font-family:'OnetSarabun';src:url(${src}) format('woff2');font-weight:${w};unicode-range:${range};}`)
  .join('') + `.sheet-print svg, .sheet-print svg text { font-family: 'OnetSarabun', sans-serif !important; }`;

/** พิมพ์กระดาษคำตอบ ON1 จากในเบราว์เซอร์ (ไม่มีเฉลย — ทุกชุดพิมพ์ได้) */
export function OnetSheetPage({ code }: { code: string }) {
  const no = Number(code.slice(1));
  const svg = useMemo(() => onetSheetSvg(getOnetTemplate(ONET_CURRENT_TEMPLATE), { setCode: code, subtitle: `ชุดติว O-NET คณิตศาสตร์ ป.6 · ชุดที่ ${no}` }), [code, no]);
  return (
    <>
      <style>{FONT_CSS}</style>
      <div className="no-print">
        <div className="crumb"><a href={href('/onet')}>ห้อง O-NET</a> › <a href={href(`/onet/sets/${code}`)}>ชุดที่ {no}</a> › กระดาษคำตอบ</div>
        <div className="page-head">
          <div>
            <h1>กระดาษคำตอบ ชุดที่ {no}</h1>
            <p className="sub">A4 แนวตั้ง 1 แผ่นต่อคน · พิมพ์ 1 แผ่นแล้วถ่ายเอกสาร · ตั้งค่าพิมพ์ "ขอบ: ไม่มี" และ "ขนาดจริง 100%"</p>
          </div>
          <button className="btn" onClick={() => window.print()}><Icon name="print" /> พิมพ์</button>
        </div>
      </div>
      <div className="sheet-print" data-testid="onet-sheet" dangerouslySetInnerHTML={{ __html: svg }} />
    </>
  );
}
