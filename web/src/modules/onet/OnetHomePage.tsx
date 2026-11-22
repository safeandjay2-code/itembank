// หน้าแรกห้อง O-NET (SPEC-ONET §8): ชุด 1–6 (ฟรี / ปลดล็อกแล้ว / ล็อก) · ขั้นตอนใช้งาน · ห้องของฉัน
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import type { Profile } from '../../core/types';
import { href } from '../../ui/router';
import { Icon } from './Icon';
import type { OnetCatalog, OnetRoom } from './types';
import './onet.css';

export function useOnetCatalog() {
  const [cat, setCat] = useState<OnetCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { repo.onet.catalog().then(setCat, (e) => setError((e as Error).message)); }, []);
  return { cat, error };
}

export function SetTag({ isFree, usable }: { isFree: boolean; usable: boolean }) {
  if (isFree) return <span className="tag free"><Icon name="gift" size={14} />ฟรี</span>;
  if (usable) return <span className="tag open"><Icon name="unlock" size={14} />ปลดล็อกแล้ว</span>;
  return <span className="tag locked"><Icon name="lock" size={14} />ล็อก</span>;
}

/** แปลงลิงก์ https://… ในข้อความผู้ดูแลเป็นลิงก์กดได้ (เช่น ลิงก์แอดเพื่อน LINE) — ข้อความอื่นแสดงตามเดิม */
export function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/[^\s]+)/g);
  return <>{parts.map((p, i) => (i % 2 === 1
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
    : p))}</>;
}

/** กล่องชุดที่ล็อก: ราคา + วิธีชำระเงิน/ส่งสลิป (ข้อความตั้งใน app_settings) */
export function LockPanel({ cat, email }: { cat: OnetCatalog; email: string | null }) {
  return (
    <section className="card lock-panel" data-testid="lock-panel">
      <h2><Icon name="lock" size={22} />{cat.priceText || 'ชุดนี้ต้องปลดล็อกก่อนใช้งาน'}</h2>
      {cat.paymentText
        ? <div className="pay-text" data-testid="payment-text"><Linkified text={cat.paymentText} /></div>
        : <p className="sub" style={{ margin: 0 }}>ช่องทางชำระเงินจะแจ้งเร็ว ๆ นี้ — ติดต่อครูวรวุฒิ เลาว้าง</p>}
      {email && <p className="hint">เมื่อโอนแล้ว ส่งสลิปพร้อมอีเมลบัญชีนี้: <b>{email}</b> — ผู้ดูแลจะปลดล็อกชุดที่เหลือทั้งหมดให้</p>}
    </section>
  );
}

export function OnetHomePage({ profile, email, blockedPath }: { profile: Profile | null; email: string | null; blockedPath?: boolean }) {
  const { cat, error } = useOnetCatalog();
  const [rooms, setRooms] = useState<OnetRoom[] | null>(null);
  useEffect(() => { repo.onet.roomList().then(setRooms, () => setRooms([])); }, []);
  const open = rooms?.filter((r) => r.status === 'open') ?? [];
  const locked = cat?.sets.filter((s) => !s.usable) ?? [];

  return (
    <>
      {blockedPath && <div className="banner" role="alert" data-testid="onet-only">บัญชีนี้ใช้ได้เฉพาะห้อง O-NET</div>}
      <div className="onet-hero">
        <div className="badge-big"><Icon name="target" size={30} /></div>
        <div>
          <h1>ห้อง O-NET คณิตศาสตร์ ป.6</h1>
          <p className="sub">สวัสดีครับ{profile?.displayName ? ` ${profile.displayName}` : ''} · ชุดติวเสมือนจริง พิมพ์ → สแกนด้วยกล้องมือถือ → รู้ทันทีว่าเด็กแต่ละคนควรเน้นอะไร</p>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <strong>ใช้งาน 4 ขั้น</strong>
        <ol className="focus-list">
          <li>เลือกชุด → ดาวน์โหลดข้อสอบ และพิมพ์ <b>กระดาษคำตอบ</b> (ถ่ายเอกสารใช้ได้ทุกคน)</li>
          <li>ให้นักเรียนระบาย <b>เลขที่ 2 หลัก</b> และรหัสชุดข้อสอบ</li>
          <li>สร้าง <a href={href('/onet/rooms')}>ห้อง</a> แล้วสแกนด้วยกล้องมือถือ — ได้คะแนนทันที</li>
          <li>ดูรายงานรายคน/รายห้อง และสไลด์เฉลยในแอป</li>
        </ol>
      </div>

      <h2>ชุดติว</h2>
      {!cat && !error && <p className="sub">กำลังโหลด…</p>}
      {cat && (
        <div className="onet-grid" data-testid="onet-sets">
          {cat.sets.map((s) => (
            <a key={s.code} href={href(`/onet/sets/${s.code}`)} className={`card onet-set ${s.usable ? '' : 'locked'}`} data-testid={`set-${s.code}`} data-usable={s.usable}>
              <SetTag isFree={s.isFree} usable={s.usable} />
              <span className="no">ชุดที่ {s.setNo}</span>
              <span>{s.title}</span>
              <span className="sub" style={{ margin: 0 }}>{s.itemCount} ข้อ · รหัสชุด {s.bubbleCode}</span>
            </a>
          ))}
        </div>
      )}
      {cat && locked.length > 0 && <LockPanel cat={cat} email={email} />}

      <h2 style={{ marginTop: 22 }}>ห้องของฉัน</h2>
      <div className="card onet-room">
        <div>
          <h3><Icon name="door" /> {open.length ? `เปิดอยู่ ${open.length} ห้อง` : 'ยังไม่มีห้อง'}</h3>
          <p className="sub">ห้อง = กลุ่มนักเรียนที่สแกนผลรวมกัน (เช่น "ป.6 ปี 2569") — เก็บผลทุกชุดของเลขที่เดียวกันไว้ด้วยกัน</p>
        </div>
        <a className="btn" href={href('/onet/rooms')} data-testid="go-rooms">{open.length ? 'ไปที่ห้องของฉัน' : 'สร้างห้อง'}</a>
      </div>
    </>
  );
}
