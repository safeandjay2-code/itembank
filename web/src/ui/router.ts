// เส้นทางแบบ hash (#/items?grade=P4) — ใช้ได้บน GitHub Pages โดยไม่ต้องตั้งค่าเซิร์ฟเวอร์
import { useEffect, useState } from 'react';

export interface Route { path: string; params: URLSearchParams }

export function parseHash(hash: string): Route {
  const raw = (hash || '#/').replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

export function href(path: string, params?: Record<string, string | number | undefined | null | boolean>): string {
  const q = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v));
  });
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

export function navigate(path: string, params?: Parameters<typeof href>[1], replace = false) {
  const h = href(path, params);
  if (h === window.location.hash) return;
  // เปลี่ยน URL แล้วแจ้งทันที (ไม่รอ hashchange แบบ async) ให้ช่องที่ผู้ใช้เพิ่งกดอัปเดตทันที
  if (replace) history.replaceState(null, '', h); else history.pushState(null, '', h);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
