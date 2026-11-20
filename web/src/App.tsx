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
import { PrintPage } from './modules/print/PrintPage';
import { ScanPage } from './modules/scan/ScanPage';
import { ScanHomePage } from './modules/scan/ScanHomePage';
import { ReportPage } from './modules/analysis/ReportPage';
import { ClosePage } from './modules/analysis/ClosePage';
import { ReportListPage } from './modules/analysis/ReportListPage';
import { HealthPage } from './modules/calibration/HealthPage';
import { ClassroomListPage } from './modules/gradebook/ClassroomListPage';
import { ClassroomNewPage } from './modules/gradebook/ClassroomNewPage';
import { ClassroomSettingsPage } from './modules/gradebook/ClassroomSettingsPage';
import { GradebookPage } from './modules/gradebook/GradebookPage';
import { TermClosePage } from './modules/gradebook/TermClosePage';
import { OnetHomePage } from './modules/onet/OnetHomePage';
import { OnetSetPage, OnetSheetPage, OnetSlidesPage } from './modules/onet/OnetSetPage';
import { OnetRoomsPage } from './modules/onet/OnetRoomsPage';
import { OnetScanPage } from './modules/onet/OnetScanPage';
import { OnetReportPage } from './modules/onet/OnetReportPage';
import { OnetAdminPage } from './modules/onet/OnetAdminPage';
import { useRoute, type Route } from './ui/router';

// เมนูของระบบ — โมดูลที่ยังไม่สร้างแสดงเป็น "เร็ว ๆ นี้" พร้อมเฟส (เพิ่มหน้าใหม่ได้ที่นี่ที่เดียว)
const NAV: Array<{ path?: string; match?: string; label: string; phase?: number; bankAdmin?: boolean }> = [
  { path: '/', label: 'หน้าแรก' },
  { path: '/classes', match: '/classes', label: 'ห้องเรียน' },
  { path: '/coverage', label: 'ผังคลังข้อสอบ' },
  { path: '/items', match: '/items', label: 'คลังข้อสอบ', bankAdmin: true },
  { path: '/backup', label: 'สำรอง/นำเข้า', bankAdmin: true },
  { path: '/exams', match: '/exams', label: 'ชุดข้อสอบ' },
  { path: '/scan', label: 'ตรวจด้วยกล้อง' },
  { path: '/reports', label: 'รายงานผล' },
  { path: '/health', label: 'สุขภาพคลัง', bankAdmin: true },
  { path: '/onet', match: '/onet', label: 'ห้อง O-NET' },
  { path: '/onet/admin', label: 'ผู้ดูแล O-NET', bankAdmin: true },
];

/** เมนูของบัญชี onet (ครูที่สมัครเองด้วย Gmail) — เห็นเฉพาะห้อง O-NET (SPEC-ONET §3.1) */
const NAV_ONET: Array<{ path: string; label: string }> = [
  { path: '/onet', label: 'ชุดติว O-NET' },
  { path: '/onet/rooms', label: 'ห้องของฉัน' },
];

/** หน้าในห้อง O-NET (null = ไม่ใช่เส้นทาง O-NET) */
function onetPage(route: Route, profile: Profile | null, email: string | null, isBankAdmin: boolean) {
  const path = route.path;
  let m: RegExpExecArray | null;
  if (path === '/onet') return <OnetHomePage profile={profile} email={email} />;
  if (path === '/onet/rooms') return <OnetRoomsPage />;
  if (path === '/onet/admin') return isBankAdmin ? <OnetAdminPage /> : <div className="card">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>;
  if ((m = /^\/onet\/sets\/([^/]+)\/slides$/.exec(path))) return <OnetSlidesPage key={m[1]} code={m[1]} />;
  if ((m = /^\/onet\/sets\/([^/]+)\/sheet$/.exec(path))) return <OnetSheetPage key={m[1]} code={m[1]} />;
  if ((m = /^\/onet\/sets\/([^/]+)$/.exec(path))) return <OnetSetPage key={m[1]} code={m[1]} email={email} />;
  if ((m = /^\/onet\/rooms\/([^/]+)\/scan$/.exec(path))) return <OnetScanPage key={m[1]} id={m[1]} route={route} />;
  if ((m = /^\/onet\/rooms\/([^/]+)\/report$/.exec(path))) return <OnetReportPage key={m[1]} id={m[1]} route={route} />;
  return null;
}

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const route = useRoute();

  useEffect(() => {
    repo.getAuth().then(setAuth);
    return repo.onAuthChange(setAuth);
  }, []);
  useEffect(() => {
    setProfileReady(false);
    if (auth?.signedIn) repo.getProfile().then((p) => { setProfile(p); setProfileReady(true); }, () => { setProfile(null); setProfileReady(true); });
    else { setProfile(null); setProfileReady(true); }
  }, [auth?.signedIn, auth?.email]);

  if (!auth) return <main><p className="sub">กำลังโหลด…</p></main>;
  if (!auth.signedIn) return <LoginPage />;
  if (!profileReady) return <main><p className="sub">กำลังโหลด…</p></main>;

  // บัญชี onet: เห็นเฉพาะห้อง O-NET — เส้นทางระบบหลักทั้งหมดพากลับหน้าแรก O-NET
  if (profile?.role === 'onet') {
    const p = route.path;
    const page = (p === '/onet/admin' ? null : onetPage(route, profile, auth.email, false)) ?? <OnetHomePage profile={profile} email={auth.email} blockedPath={p !== '/'} />;
    return (
      <>
        <header className="topbar">
          <div className="brand">ห้อง O-NET คณิต ป.6</div>
          <span className="sub user" style={{ margin: 0, fontSize: '.85rem' }}>{auth.email}</span>
          <button className="btn ghost" onClick={() => repo.signOut()}>ออกจากระบบ</button>
        </header>
        <nav className="nav" aria-label="เมนูหลัก">
          {NAV_ONET.map((n) => {
            const active = n.path === '/onet' ? p === '/onet' || p === '/' || p.startsWith('/onet/sets') : p.startsWith(n.path);
            return <a key={n.path} href={`#${n.path}`} className={active ? 'active' : ''}>{n.label}</a>;
          })}
        </nav>
        <main>
          {repo.mode === 'memory' && <div className="banner">โหมดสาธิต — ข้อมูลจำลอง ไม่ได้เชื่อมฐานข้อมูลจริง</div>}
          {page}
        </main>
      </>
    );
  }

  const isBankAdmin = profile?.role === 'owner' || profile?.role === 'admin';
  const path = route.path;
  const itemMatch = /^\/items\/(.+)$/.exec(path);
  const printMatch = /^\/exams\/([^/]+)\/print$/.exec(path);
  const scanMatch = /^\/exams\/([^/]+)\/scan$/.exec(path);
  const reportMatch = /^\/exams\/([^/]+)\/report$/.exec(path);
  const closeMatch = /^\/exams\/([^/]+)\/close$/.exec(path);
  const examMatch = /^\/exams\/([^/]+)$/.exec(path);
  const classMatch = /^\/classes\/([^/]+)$/.exec(path);
  const bookMatch = /^\/classes\/([^/]+)\/book$/.exec(path);
  const termMatch = /^\/classes\/([^/]+)\/close$/.exec(path);

  function page() {
    const needsAdmin = path.startsWith('/items') || path === '/backup' || path === '/health';
    if (needsAdmin && profile && !isBankAdmin) return <div className="card">หน้านี้สำหรับผู้ดูแลคลังข้อสอบเท่านั้น</div>;
    if (needsAdmin && !profile) return <p className="sub">กำลังโหลด…</p>;
    if (path === '/classes') return <ClassroomListPage />;
    if (path === '/classes/new') return <ClassroomNewPage />;
    if (termMatch) return <TermClosePage key={termMatch[1]} id={termMatch[1]} />;
    if (bookMatch) return <GradebookPage key={bookMatch[1]} id={bookMatch[1]} route={route} />;
    if (classMatch) return <ClassroomSettingsPage key={classMatch[1]} id={classMatch[1]} route={route} />;
    if (path === '/coverage') return <CoveragePage />;
    if (path === '/items') return <ItemListPage route={route} />;
    if (itemMatch) return <ItemEditorPage key={itemMatch[1]} id={itemMatch[1] === 'new' ? null : itemMatch[1]} params={route.params} />;
    if (path === '/backup') return <BackupPage />;
    if (path === '/health') return <HealthPage />;
    if (path === '/exams') return <ExamListPage />;
    if (path === '/exams/new') return <ExamBuilderPage route={route} />;
    if (path === '/scan') return <ScanHomePage />;
    if (scanMatch) return <ScanPage key={scanMatch[1]} id={scanMatch[1]} route={route} />;
    if (path === '/reports') return <ReportListPage />;
    if (reportMatch) return <ReportPage key={reportMatch[1]} id={reportMatch[1]} route={route} canOpenItems={isBankAdmin} />;
    if (closeMatch) return <ClosePage key={closeMatch[1]} id={closeMatch[1]} />;
    if (printMatch) return <PrintPage key={printMatch[1]} id={printMatch[1]} route={route} />;
    if (path === '/dev/print-sample' && repo.mode === 'memory') return <PrintPage id={null} route={route} />;
    const onet = path.startsWith('/onet') ? onetPage(route, profile, auth!.email, isBankAdmin) : null;
    if (onet) return onet;
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
          const active = n.path === '/onet' ? path.startsWith('/onet') && path !== '/onet/admin'
            : n.path === '/onet/admin' ? path === '/onet/admin'
            : n.path === '/scan' ? path === '/scan' || !!scanMatch
            : n.path === '/reports' ? path === '/reports' || !!reportMatch || !!closeMatch
            : n.match ? path.startsWith(n.match) && !scanMatch && !reportMatch && !closeMatch : path === n.path;
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
