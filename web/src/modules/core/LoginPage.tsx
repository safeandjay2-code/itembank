import { useState, type FormEvent } from 'react';
import { repo } from '../../data';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await repo.signIn(email.trim(), password); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <form className="card login" onSubmit={submit} aria-label="เข้าสู่ระบบ">
        <h1>เข้าสู่ระบบ</h1>
        <p className="sub">ระบบคลังข้อสอบและตรวจข้อสอบ คณิตศาสตร์ ป.4–6</p>
        <label htmlFor="email">อีเมล</label>
        <input id="email" type="email" autoComplete="username" value={email}
               onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">รหัสผ่าน</label>
        <input id="password" type="password" autoComplete="current-password" value={password}
               onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        {error && <div className="error" role="alert">{error}</div>}
        {repo.mode === 'memory' && <div className="hint">โหมดสาธิต: demo@itembank.local / demo1234</div>}
      </form>
    </main>
  );
}
