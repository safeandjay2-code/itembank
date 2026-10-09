import { useEffect, useState } from 'react';
import { repo } from './data';
import type { AuthState } from './data/repo';
import type { Profile } from './core/types';
import { LoginPage } from './modules/core/LoginPage';
import { HomePage } from './modules/core/HomePage';
import { CoveragePage } from './modules/bank/CoveragePage';

// เมนูของระบบ — โมดูลที่ยังไม่สร้างแสดงเป็น "เร็ว ๆ นี้" พร้อมเฟส (เพิ่มหน้าใหม่ได้ที่นี่ที่เดียว)
const NAV = [
  { path: '#/', label: 'หน้าแรก' },
  { path: '#/coverage', label: 'ผังคลังข้อสอบ' },
  { label: 'จัดการข้อสอบ', phase: 2 },
  { label: 'สร้างชุดข้อสอบ', phase: 3 },
  { label: 'ตรวจด้วยกล้อง', phase: 5 },
  { label: 'รายงานผล', phase: 6 },
];

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    repo.getAuth().then(setAuth);
    return repo.onAuthChange(setAuth);
  }, []);
  useEffect(() => {
    if (auth?.signedIn) repo.getProfile().then(setProfile); else setProfile(null);
  }, [auth?.signedIn]);

  if (!auth) return <main><p className="sub">กำลังโหลด…</p></main>;
  if (!auth.signedIn) return <LoginPage />;

  return (
    <>
      <header className="topbar">
        <div className="brand">คลังข้อสอบคณิต ป.4–6</div>
        <span className="sub" style={{ margin: 0, fontSize: '.85rem' }}>{auth.email}</span>
        <button className="btn ghost" onClick={() => repo.signOut()}>ออกจากระบบ</button>
      </header>
      <nav className="nav" aria-label="เมนูหลัก">
        {NAV.map((n) => n.path
          ? <a key={n.label} href={n.path} className={route === n.path ? 'active' : ''}>{n.label}</a>
          : <span key={n.label} className="soon">{n.label}<small>(เฟส {n.phase})</small></span>)}
      </nav>
      <main>
        {repo.mode === 'memory' && <div className="banner">โหมดสาธิต — ข้อมูลจำลอง ไม่ได้เชื่อมฐานข้อมูลจริง</div>}
        {route === '#/coverage' ? <CoveragePage /> : <HomePage profile={profile} />}
      </main>
    </>
  );
}
