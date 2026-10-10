import { useEffect, useState } from 'react';
import { repo } from '../../data';
import type { Profile } from '../../core/types';
import { summarizeCoverage, type CoverageSummary } from '../bank/coverage';

const ROLE_TH: Record<string, string> = { owner: 'เจ้าของระบบ', admin: 'ผู้ดูแล', teacher: 'ครู' };

export function HomePage({ profile }: { profile: Profile | null }) {
  const [sum, setSum] = useState<CoverageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [inds, cells, settings] = await Promise.all([
          repo.getIndicators('MATH'), repo.getCoverage('MATH'), repo.getSettings()]);
        const target = Number(settings['bank.items_per_level_target'] ?? 20);
        setSum(summarizeCoverage(inds, cells, target));
      } catch (e) { setError((e as Error).message); }
    })();
  }, []);

  return (
    <>
      <h1>สวัสดีครับ{profile?.displayName ? ` ${profile.displayName}` : ''}</h1>
      <p className="sub">บทบาท: {profile ? ROLE_TH[profile.role] : '—'}</p>
      {error && <div className="error" role="alert">{error}</div>}
      {sum && (
        <div className="cards" data-testid="home-stats">
          <div className="card"><div className="stat-label">ตัวชี้วัดปลายทาง</div><div className="stat-value" data-testid="stat-indicators">{sum.indicatorCount}</div></div>
          <div className="card"><div className="stat-label">ข้อพร้อมใช้ในคลัง</div><div className="stat-value" data-testid="stat-ready">{sum.ready.toLocaleString('th-TH')}</div></div>
          <div className="card"><div className="stat-label">เป้าหมายคลัง</div><div className="stat-value">{sum.target.toLocaleString('th-TH')}</div></div>
          <div className="card"><div className="stat-label">ความครบ</div><div className="stat-value">{sum.percent}%</div></div>
        </div>
      )}
      <div className="card">
        <strong>สถานะการสร้างระบบ</strong>
        <p className="sub" style={{ margin: '6px 0 0' }}>
          เฟส 3 (ประกอบชุดข้อสอบ) — เลือกตัวชี้วัด/ระดับ/จำนวนข้อ แล้วระบบเลือกข้อ n น้อยก่อน ผสมข้อยึดค่า เรียงตามหลักสูตร
          สลับข้อและตัวเลือกหลายชุด กำหนดชุดตามเลขที่ และตรวจความสมดุลเฉลยให้เอง · เมนูที่ขึ้นว่า "เฟส" จะเปิดตามลำดับการสร้าง
        </p>
      </div>
    </>
  );
}
