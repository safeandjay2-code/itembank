// เครื่องมือทดสอบห้อง O-NET: ล็อกอินบัญชีสาธิต · ฝนกระดาษ ON1 + ถ่ายภาพจำลอง
import { expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { onetDemoKey } from '../../src/data/onetMemory';
import { TMP } from './scanTools';

export { onetDemoKey };

/** กระดาษ ON1 + ตำแหน่งวง ดึงจากแอป (โหมดสาธิต) — แบบกระดาษ/ตัววาดตัวเดียวกับที่ครูพิมพ์ */
interface SheetSpec { svg: string; paper: { width: number; height: number }; bubbles: Array<{ key: string; x: number; y: number; r: number }> }
const SHEETS = new Map<string, SheetSpec>();
export async function loadSheets(page: Page) {
  for (const code of ['S01', 'S02', 'S03']) {
    if (!SHEETS.has(code)) SHEETS.set(code, await page.evaluate((c) => (window as any).__itembankDemo.onetSheet(c), code));
  }
}

export async function loginAs(page: Page, email: string, first = true) {
  if (first) await page.goto('/');
  await page.getByLabel('อีเมล', { exact: true }).fill(email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
}

/** คีย์วงที่ฝน: เลขที่ (null หลักสิบ = ลืมระบาย 0) + คำตอบ 15 ข้อ + รหัสชุด */
export function marksFor(setNo: number, seat: [number | null, number], answers: string[]): string[] {
  const m = [`set:${setNo * 100}`];
  if (seat[0] !== null) m.push(`seat:c0:${seat[0]}`);
  m.push(`seat:c1:${seat[1]}`);
  answers.forEach((a, i) => {
    if (i < 11) m.push(`q${i + 1}:${a}`);
    else a.split('').forEach((d, c) => m.push(`q${i + 1}:c${c}:${d}`));
  });
  return m;
}

/** ภาพถ่ายกระดาษ ON1 ที่ฝนแล้ว (เอียงเล็กน้อย บนโต๊ะเทา) → PNG + RGBA */
export function onetPhoto(setNo: number, marks: string[], opts: { rotate?: number; widthPx?: number } = {}) {
  const sh = SHEETS.get(`S0${setNo}`);
  if (!sh) throw new Error('เรียก loadSheets(page) ก่อน');
  const bub = new Map(sh.bubbles.map((b) => [b.key, b]));
  const pencil = marks.map((k) => {
    const b = bub.get(k)!;
    return `<ellipse cx="${b.x + 0.1}" cy="${b.y - 0.1}" rx="${b.r * 0.85}" ry="${b.r * 0.8}" fill="#2a2a2a"/>`;
  }).join('');
  const inner = sh.svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const W = sh.paper.width, H = sh.paper.height, m = 8;
  const scene = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${W + 2 * m} ${H + 2 * m}">`
    + `<rect x="${-m}" y="${-m}" width="${W + 2 * m}" height="${H + 2 * m}" fill="#6b6b6b"/>`
    + `<g transform="rotate(${opts.rotate ?? 2} ${W / 2} ${H / 2})"><rect width="${W}" height="${H}" fill="#fff"/>${inner}${pencil}</g></svg>`;
  const img = new Resvg(scene, { fitTo: { mode: 'width', value: opts.widthPx ?? 1300 }, background: '#6b6b6b', font: { loadSystemFonts: true } }).render();
  return { png: img.asPng(), rgba: img.pixels, w: img.width, h: img.height };
}

let n = 0;
export function onetPhotoFile(setNo: number, marks: string[], opts?: { rotate?: number; widthPx?: number }): string {
  const f = join(TMP, `onet-${setNo}-${++n}.png`);
  writeFileSync(f, onetPhoto(setNo, marks, opts).png);
  return f;
}
