import { useEffect, useState } from 'react';
import { repo } from '../../data';
import type { Profile } from '../../core/types';
import { summarizeCoverage, type CoverageSummary } from '../bank/coverage';
import { ExpiryNotice } from '../analysis/expiry';
import type { BankHealth } from '../calibration/calibrate';
import { href } from '../../ui/router';

const ROLE_TH: Record<string, string> = { owner: 'เจ้าของระบบ', admin: 'ผู้ดูแล', teacher: 'ครู' };

export function HomePage({ profile }: { profile: Profile | null }) {
  const [sum, setSum] = useState<CoverageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<BankHealth | null>(null);
  const isBankAdmin = profile?.role === 'owner' || profile?.role === 'admin';
  useEffect(() => {
    if (isBankAdmin) repo.getBankHealth('MATH').then(setHealth, () => setHealth(null));
  }, [isBankAdmin]);
  const urgent = health?.flagged.filter((f) => f.flag === 'negative_r').length ?? 0;
  const lowR = health?.flagged.filter((f) => f.flag === 'low_r').length ?? 0;
  const movedCells = health?.shortfalls.filter((s) => (s.movedOut ?? 0) > 0).length ?? 0;

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
      <ExpiryNotice />
      {health && (urgent > 0 || movedCells > 0 || lowR > 0) && (
        <div className="card expiry" role="alert" data-testid="home-bank-alerts" style={{ marginBottom: 14 }}>
          <strong>สุขภาพคลังข้อสอบ</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {urgent > 0 && <li>ต้องแก้ด่วน {urgent} ข้อ (ค่า r ติดลบ — หยุดสุ่มเข้าชุดแล้ว)</li>}
            {lowR > 0 && <li>ค่า r ต่ำ ควรปรับปรุง {lowR} ข้อ</li>}
            {movedCells > 0 && <li>{movedCells} ช่องต่ำกว่าเป้าเพราะมีข้อย้ายระดับออก — ต้องเติมข้อ</li>}
          </ul>
          <a href={href('/health')}>ดูหน้าสุขภาพคลัง</a>
        </div>
      )}
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
          ครบ 7 เฟส — คลังข้อสอบ → ประกอบชุด → พิมพ์ → ตรวจด้วยกล้อง → รายงานและปิดชุด → ปรับความยากอัตโนมัติ
          (ทุกครั้งที่ปิดชุด ระบบย้ายระดับข้อที่มีนักเรียนทำครบตามเกณฑ์ตามค่า p จริง และติดป้ายข้อที่ค่า r ต่ำ) · ดูภาพรวมได้ที่เมนู "สุขภาพคลัง"
        </p>
      </div>
    </>
  );
}
