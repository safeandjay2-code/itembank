// ห้องของฉัน (O-NET): สร้าง/เปลี่ยนชื่อ/ลบ · ไปสแกน · ไปรายงาน (ปิดห้องอยู่ในหน้ารายงาน — ส่งออก Excel ก่อน)
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { repo } from '../../data';
import { href, navigate } from '../../ui/router';
import { thDate } from '../analysis/expiry';
import { Icon } from './Icon';
import type { OnetRoom } from './types';
import './onet.css';

export function OnetRoomsPage() {
  const [rooms, setRooms] = useState<OnetRoom[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => repo.onet.roomList().then(setRooms, (e) => setError((e as Error).message)), []);
  useEffect(() => { reload(); }, [reload]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { const id = await repo.onet.roomCreate(name); setName(''); navigate(`/onet/rooms/${id}/scan`); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await reload(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="crumb"><a href={href('/onet')}>ห้อง O-NET</a> › ห้องของฉัน</div>
      <h1>ห้องของฉัน</h1>
      <p className="sub">ผลของเลขที่เดียวกันทุกชุดอยู่ในห้องเดียวกัน · ไม่เก็บชื่อนักเรียน · ห้องหมดอายุอัตโนมัติหลังฤดูสอบ (ผลรายคนถูกลบ — ส่งออก Excel ไว้ก่อน)</p>
      <form className="card onet-room" onSubmit={create} aria-label="สร้างห้อง">
        <label style={{ flex: 1, minWidth: 200 }}>
          <span className="sub" style={{ display: 'block', margin: '0 0 4px' }}>ชื่อห้องใหม่</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ป.6/1 ปี 2569" maxLength={80} required
            aria-label="ชื่อห้องใหม่" style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 8 }} />
        </label>
        <button className="btn" disabled={busy || !name.trim()} data-testid="room-create"><Icon name="plus" /> สร้างห้อง</button>
      </form>
      {error && <div className="error box" role="alert">{error}</div>}
      {!rooms && !error && <p className="sub">กำลังโหลด…</p>}
      {rooms && !rooms.length && <p className="sub">ยังไม่มีห้อง — ตั้งชื่อแล้วกด "สร้างห้อง"</p>}
      <div data-testid="room-list">
        {rooms?.map((r) => (
          <div key={r.id} className={`card onet-room ${r.status}`} data-testid="room">
            <div>
              <h3><Icon name="door" /> {r.name} {r.status === 'closed' && <span className="tag locked">ปิดแล้ว</span>}</h3>
              <p className="sub">
                {r.status === 'open'
                  ? <>นักเรียน {r.students} คน · {r.sheets} แผ่น · หมดอายุ {thDate(r.expiresAt)}</>
                  : <>ปิดเมื่อ {r.closedAt ? thDate(r.closedAt) : '–'} · ผลรายคนถูกลบแล้ว</>}
              </p>
            </div>
            <div className="actions wrap" style={{ marginTop: 0 }}>
              {r.status === 'open' && <a className="btn" href={href(`/onet/rooms/${r.id}/scan`)}><Icon name="camera" /> สแกน</a>}
              {r.status === 'open' && <a className="btn ghost icon-btn" href={href(`/onet/rooms/${r.id}/report`)}><Icon name="chart" /> รายงาน</a>}
              <button className="btn ghost" onClick={() => { const n = prompt('ชื่อห้องใหม่', r.name); if (n && n.trim()) act(() => repo.onet.roomRename(r.id, n)); }}>เปลี่ยนชื่อ</button>
              {(r.status === 'closed' || r.sheets === 0) && (
                <button className="btn ghost icon-btn" onClick={() => { if (confirm(`ลบห้อง "${r.name}"?`)) act(() => repo.onet.roomDelete(r.id)); }}><Icon name="trash" /> ลบ</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
