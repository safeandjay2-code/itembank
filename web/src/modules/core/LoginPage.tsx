import { useState, type FormEvent } from 'react';
import { repo } from '../../data';

/** อ่านข้อผิดพลาดที่ผู้ให้บริการล็อกอินส่งกลับมาทาง URL (เช่น ไม่อนุญาตให้สมัครใหม่) */
function errorFromUrl(): string | null {
  const q = new URLSearchParams(window.location.search);
  const h = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
  const msg = q.get('error_description') || h.get('error_description');
  if (!msg) return null;
  if (/signups? not allowed/i.test(msg)) return 'บัญชี Google นี้ยังไม่ได้รับอนุญาตให้ใช้ระบบ กรุณาติดต่อผู้ดูแลระบบ';
  return msg;
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(errorFromUrl());
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(repo.mode === 'memory');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await repo.signIn(email.trim(), password); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function google() {
    setBusy(true); setError(null);
    try { await repo.signInWithGoogle(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <main>
      <div className="card login">
        <h1>เข้าสู่ระบบ</h1>
        <p className="sub">ระบบคลังข้อสอบและตรวจข้อสอบ คณิตศาสตร์ ป.4–6</p>
        {repo.mode === 'supabase' && (
          <button className="btn" type="button" onClick={google} disabled={busy}>เข้าสู่ระบบด้วย Google</button>
        )}
        {!showEmail && (
          <p className="hint"><a href="#" onClick={(e) => { e.preventDefault(); setShowEmail(true); }}>เข้าด้วยอีเมลและรหัสผ่าน</a></p>
        )}
        {showEmail && (
          <form onSubmit={submit} aria-label="เข้าสู่ระบบด้วยอีเมล">
            <label htmlFor="email">อีเมล</label>
            <input id="email" type="email" autoComplete="username" value={email}
                   onChange={(e) => setEmail(e.target.value)} required />
            <label htmlFor="password">รหัสผ่าน</label>
            <input id="password" type="password" autoComplete="current-password" value={password}
                   onChange={(e) => setPassword(e.target.value)} required />
            <button className={repo.mode === 'memory' ? 'btn' : 'btn ghost'} type="submit" disabled={busy}>
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        {repo.mode === 'memory' && <div className="hint">โหมดสาธิต: demo@itembank.local / demo1234</div>}
      </div>
    </main>
  );
}
