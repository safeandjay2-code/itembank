// หน้าผู้ดูแลห้อง O-NET (owner/admin): ค้นอีเมลครู → ปลดล็อก/ยกเลิก · จำนวนผู้ใช้ · สถิติรวมรายข้อ
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { repo } from '../../data';
import { href } from '../../ui/router';
import { thDate } from '../analysis/expiry';
import { Icon } from './Icon';
import type { OnetAdminStats, OnetAdminUser } from './types';
import './onet.css';

export function OnetAdminPage() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<OnetAdminUser[] | null>(null);
  const [stats, setStats] = useState<OnetAdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const search = useCallback((query: string) => repo.onet.adminUsers(query).then(setUsers, (e) => setError((e as Error).message)), []);
  const loadStats = useCallback(() => repo.onet.adminStats().then(setStats, (e) => setError((e as Error).message)), []);
  useEffect(() => { search(''); loadStats(); }, [search, loadStats]);

  async function act(fn: () => Promise<void>) {
    setError(null);
    try { await fn(); await Promise.all([search(q), loadStats()]); } catch (e) { setError((e as Error).message); }
  }
  function submit(e: FormEvent) { e.preventDefault(); search(q); }

  return (
    <>
      <div className="crumb"><a href={href('/onet')}>ห้อง O-NET</a> › ผู้ดูแล</div>
      <h1><Icon name="shield" size={24} /> ผู้ดูแลห้อง O-NET</h1>
      {error && <div className="error box" role="alert">{error}</div>}
      {stats && (
        <div className="onet-stats" data-testid="onet-admin-stats">
          <div className="card"><div className="stat-label">ครูที่สมัคร (onet)</div><div className="stat-value">{stats.users}</div></div>
          <div className="card"><div className="stat-label">ปลดล็อกแล้ว</div><div className="stat-value">{stats.entitled}</div></div>
          <div className="card"><div className="stat-label">ห้องที่เปิดอยู่</div><div className="stat-value">{stats.openRooms}</div></div>
          <div className="card"><div className="stat-label">กระดาษที่สแกน (ห้องเปิด)</div><div className="stat-value">{stats.sheets}</div></div>
        </div>
      )}

      <h2>ปลดล็อกชุดที่ 3–6</h2>
      <p className="sub">ค้นด้วยอีเมล/ชื่อ/โรงเรียน → ใส่หมายเหตุ (เช่น "สลิป 20 พ.ย." หรือ "เครือข่ายแม่ริม ฟรี") → กดปลดล็อก</p>
      <form onSubmit={submit} className="actions wrap" style={{ marginTop: 0, marginBottom: 12 }}>
        <input aria-label="ค้นหาครู" value={q} onChange={(e) => setQ(e.target.value)} placeholder="อีเมล ชื่อ หรือโรงเรียน"
          style={{ flex: 1, minWidth: 200, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 8 }} />
        <button className="btn"><Icon name="search" /> ค้นหา</button>
      </form>
      <div className="table-wrap">
        <table className="onet-items" data-testid="onet-admin-users">
          <thead><tr><th>ครู</th><th>บทบาท</th><th>สมัคร</th><th className="num">ห้อง/แผ่น</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} data-email={u.email}>
                <td><b>{u.email}</b><div className="muted">{u.displayName}{u.schoolName ? ` · ${u.schoolName}` : ''}</div></td>
                <td>{u.role}</td>
                <td>{thDate(u.createdAt)}</td>
                <td className="num">{u.rooms}/{u.sheets}</td>
                <td>{u.entitled
                  ? <span className="ok-text"><Icon name="unlock" size={15} /> ปลดล็อกแล้ว{u.note ? ` · ${u.note}` : ''}</span>
                  : <span className="muted"><Icon name="lock" size={15} /> ฟรี 2 ชุด</span>}</td>
                <td style={{ minWidth: 220 }}>
                  {u.entitled
                    ? <button className="btn ghost" onClick={() => { if (confirm(`ยกเลิกการปลดล็อกของ ${u.email}?`)) act(() => repo.onet.adminRevoke(u.id)); }}>ยกเลิก</button>
                    : (
                      <div className="actions wrap" style={{ marginTop: 0 }}>
                        <input aria-label={`หมายเหตุ ${u.email}`} value={notes[u.id] ?? ''} onChange={(e) => setNotes({ ...notes, [u.id]: e.target.value })}
                          placeholder="หมายเหตุ" style={{ width: 130, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6 }} />
                        <button className="btn" onClick={() => act(() => repo.onet.adminGrant(u.id, (notes[u.id] ?? '').trim() || null))}>ปลดล็อก</button>
                      </div>
                    )}
                </td>
              </tr>
            ))}
            {users && !users.length && <tr><td colSpan={6} className="empty">ไม่พบผู้ใช้</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 24 }}>สถิติรวมรายข้อ (จากห้องที่ปิดแล้ว)</h2>
      {stats && !stats.items.length && <p className="sub">ยังไม่มี — สถิติจะรวมเข้ามาเมื่อครูปิดห้องหรือห้องหมดอายุ</p>}
      {stats && stats.items.length > 0 && (
        <div className="table-wrap">
          <table className="onet-items" data-testid="onet-admin-items">
            <thead><tr><th>ชุด</th><th>ข้อ</th><th className="num">n</th><th className="num">ตอบถูก</th><th>คำตอบที่เลือก</th></tr></thead>
            <tbody>{stats.items.map((s) => (
              <tr key={`${s.setCode}-${s.itemNo}`}>
                <td>{s.setCode}</td><td>{s.itemNo}</td><td className="num">{s.n}</td><td className="num">{s.p === null ? '–' : `${Math.round(s.p * 100)}%`}</td>
                <td className="muted">{Object.entries(s.answerCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k === '_blank' ? 'ไม่ตอบ' : k}: ${v}`).join(' · ')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
