// ไอคอนเส้นของห้อง O-NET (วาดเองทั้งหมด — ไม่ต้องใส่เครดิตแหล่งไอคอน)
const P: Record<string, string> = {
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3.6 7.6 7 12 7zM12 7s1.5-4 4-3.4.4 3.4-4 3.4z',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  play: 'M7 4.5v15l12-7.5z',
  print: 'M7 9V3h10v6M6 18H4v-7h16v7h-2M7 14h10v7H7z',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 17.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M18 15a6 6 0 0 1 4 5.5V21',
  door: 'M5 21V3h11v18M16 5h3v16M12.5 12h.01M3 21h18',
  plus: 'M12 5v14M5 12h14',
  check: 'M4.5 12.5l5 5 10-11',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  x: 'M6 6l12 12M18 6L6 18',
  sheet: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h.01M12 13h3M9 17h.01M12 17h3',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
