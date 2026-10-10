// วันหมดอายุของข้อมูลรายเลขที่ (SPEC §10) — ตัวช่วยคำนวณวันที่เหลือและป้ายแจ้งเตือนล่วงหน้า
import { useEffect, useState } from 'react';
import { repo } from '../../data';
import type { ExamSummary, Settings } from '../../core/types';
import { href } from '../../ui/router';

const DAY = 86_400_000;

/** จำนวนวันที่เหลือก่อนหมดอายุ (ปัดขึ้น) — null = ไม่มีวันหมดอายุ */
export function daysLeft(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / DAY));
}

export function warnDays(settings: Settings | undefined): number {
  const v = settings?.['privacy.expiry_warn_days'];
  return typeof v === 'number' ? v : 7;
}

export const thDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '–';

export function expiryText(expiresAt: string | null): string {
  const d = daysLeft(expiresAt);
  if (d === null) return '';
  return d === 0 ? 'ข้อมูลรายเลขที่จะถูกลบวันนี้' : `ข้อมูลรายเลขที่จะถูกลบอัตโนมัติ ${thDate(expiresAt)} (อีก ${d} วัน)`;
}

/** ชุดที่ใกล้หมดอายุ (ภายใน privacy.expiry_warn_days วัน) */
export function expiringSoon(exams: ExamSummary[], settings: Settings | undefined, now = Date.now()): ExamSummary[] {
  const w = warnDays(settings);
  return exams.filter((e) => e.status === 'open' && daysLeft(e.expiresAt, now) !== null && daysLeft(e.expiresAt, now)! <= w)
    .sort((a, b) => Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!));
}

/** ป้ายแจ้งเตือนล่วงหน้า: ชุดที่ข้อมูลรายเลขที่ใกล้ถูกลบ ให้ส่งออกรายงาน/ปิดชุดก่อน */
export function ExpiryNotice({ exams, settings }: { exams?: ExamSummary[] | null; settings?: Settings }) {
  const [list, setList] = useState<ExamSummary[] | null>(exams ?? null);
  const [cfg, setCfg] = useState<Settings | undefined>(settings);
  useEffect(() => { if (exams) setList(exams); else repo.listExams('MATH').then(setList, () => setList([])); }, [exams]);
  useEffect(() => { if (!settings) repo.getSettings().then(setCfg, () => undefined); else setCfg(settings); }, [settings]);
  const soon = list ? expiringSoon(list, cfg) : [];
  if (!soon.length) return null;
  return (
    <div className="card expiry" role="status" data-testid="expiry-notice" style={{ marginBottom: 16 }}>
      <strong>ข้อมูลรายเลขที่ใกล้ถูกลบอัตโนมัติ</strong>
      <p className="sub" style={{ margin: '4px 0 6px' }}>ดาวน์โหลดรายงาน (Excel/PDF) แล้วปิดชุดข้อสอบก่อนครบกำหนด — ถ้าไม่ปิด ระบบจะรวมสถิติเข้าคลังแล้วลบคะแนนรายเลขที่ให้เอง</p>
      <ul className="plain">
        {soon.map((e) => (
          <li key={e.id}><a href={href(`/exams/${e.id}/report`)}>{e.title}</a> — {expiryText(e.expiresAt)}</li>
        ))}
      </ul>
    </div>
  );
}
