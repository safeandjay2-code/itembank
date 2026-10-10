import { useEffect, useState } from 'react';
import { repo } from './data';
import type { AuthState } from './data/repo';
import type { Profile } from './core/types';
import { LoginPage } from './modules/core/LoginPage';
import { HomePage } from './modules/core/HomePage';
import { CoveragePage } from './modules/bank/CoveragePage';
import { ItemListPage } from './modules/bank/ItemListPage';
import { ItemEditorPage } from './modules/bank/ItemEditorPage';
import { BackupPage } from './modules/bank/BackupPage';
import { ExamListPage } from './modules/assembly/ExamListPage';
import { ExamBuilderPage } from './modules/assembly/ExamBuilderPage';
import { ExamDetailPage } from './modules/assembly/ExamDetailPage';
import { useRoute } from './ui/router';

// เมนูของระบบ — โมดูลที่ยังไม่สร้างแสดงเป็น "เร็ว ๆ นี้" พร้อมเฟส (เพิ่มหน้าใหม่ได้ที่นี่ที่เดียว)
const NAV: Array<{ path?: string; match?: string; label: string; phase?: number; bankAdmin?: boolean }> = [
  { path: '/', label: 'หน้าแรก' },
  { path: '/coverage', label: 'ผังคลังข้อสอบ' },
  { path: '/items', match: '/items', label: 'คลังข้อสอบ', bankAdmin: true },
  { path: '/backup', label: 'สำรอง/นำเข้า', bankAdmin: true },
  { path: '/exams', match: '/exams', label: 'ชุดข้อสอบ' },
  { label: 'ตรวจด้วยกล้อง', phase: 5 },
  { label: 'รายงานผล', phase: 6 },
];

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const route = useRoute();

  useEffect(() => {
    repo.getAuth().then(setAuth);
    return repo.onAuthChange(setAuth);
  }, []);
  useEffect(() => {
    if (auth?.signedIn) repo.getProfile().then(setProfile); else setProfile(null);
  }, [auth?.signedIn]);

  if (!auth) return <main><p className="sub">กำลังโหลด…</p></main>;
  if (!auth.signedIn) return <LoginPage />;

  const isBankAdmin = profile?.role === 'owner' || profile?.role === 'admin';
  const path = route.path;
  const itemMatch = /^\/items\/(.+)$/.exec(path);
  const examMatch = /^\/exams\/(.+)$/.exec(path);

  function page() {
    const needsAdmin = path.startsWith('/items') || path === '/backup';
    if (needsAdmin && profile && !isBankAdmin) return <div className="card">หน้านี้สำหรับผู้ดูแลคลังข้อสอบเท่านั้น</div>;
    if (needsAdmin && !profile) return <p className="sub">กำลังโหลด…</p>;
    if (path === '/coverage') return <CoveragePage />;
    if (path === '/items') return <ItemListPage route={route} />;
    if (itemMatch) return <ItemEditorPage key={itemMatch[1]} id={itemMatch[1] === 'new' ? null : itemMatch[1]} params={route.params} />;
    if (path === '/backup') return <BackupPage />;
    if (path === '/exams') return <ExamListPage />;
    if (path === '/exams/new') return <ExamBuilderPage route={route} />;
    if (examMatch) return <ExamDetailPage key={examMatch[1]} id={examMatch[1]} route={route} canOpenItems={isBankAdmin} />;
    return <HomePage profile={profile} />;
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">คลังข้อสอบคณิต ป.4–6</div>
        <span className="sub user" style={{ margin: 0, fontSize: '.85rem' }}>{auth.email}</span>
        <button className="btn ghost" onClick={() => repo.signOut()}>ออกจากระบบ</button>
      </header>
      <nav className="nav" aria-label="เมนูหลัก">
        {NAV.filter((n) => !n.bankAdmin || isBankAdmin).map((n) => {
          if (!n.path) return <span key={n.label} className="soon">{n.label}<small>(เฟส {n.phase})</small></span>;
          const active = n.match ? path.startsWith(n.match) : path === n.path;
          return <a key={n.label} href={`#${n.path}`} className={active ? 'active' : ''}>{n.label}</a>;
        })}
      </nav>
      <main>
        {repo.mode === 'memory' && <div className="banner">โหมดสาธิต — ข้อมูลจำลอง ไม่ได้เชื่อมฐานข้อมูลจริง</div>}
        {page()}
      </main>
    </>
  );
}
