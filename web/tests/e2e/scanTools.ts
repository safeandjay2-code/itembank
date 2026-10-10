// เครื่องมือทดสอบเฟส 5: สร้างชุด, ดึง SVG กระดาษคำตอบจริงจากหน้าพิมพ์, ฝน + ถ่ายภาพจำลอง, วิดีโอกล้องจำลอง
import { expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

export const TPL = JSON.parse(readFileSync(new URL('../../../data/answer_sheet_template_v1.json', import.meta.url), 'utf8'));
export const IND1 = 'ค 1.1 ป.4/2', IND2 = 'ค 1.1 ป.4/11';
export const TMP = mkdtempSync(join(tmpdir(), 'p5-'));
export const FAKE_VIDEO = join(tmpdir(), 'itembank-fake-camera.y4m');

export async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('อีเมล', { exact: true }).fill('demo@itembank.local');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByTestId('stat-ready')).toHaveText('264');
}

export async function setRow(page: Page, n: number, ind: string, level: string, count: number) {
  await page.getByLabel(`ตัวชี้วัด แถว ${n}`).selectOption({ label: ind });
  await page.getByLabel(`ระดับ แถว ${n}`).selectOption({ label: level });
  await page.getByLabel(`จำนวน แถว ${n}`).fill(String(count));
}

/** ชุด ป.4: 6 ข้อ 3 ชุด นักเรียน 7 คน (เลขที่ 3 ได้ชุด 3) */
export async function createExam(page: Page): Promise<string> {
  await page.goto('/#/exams/new');
  await page.getByRole('button', { name: 'ป.4', exact: true }).click();
  await page.getByLabel('จำนวนข้อ', { exact: true }).fill('6');
  await page.getByLabel('จำนวนชุด (กันลอก)').fill('3');
  await setRow(page, 1, IND1, 'ง่าย', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 2, IND1, 'ปานกลาง', 2);
  await page.getByRole('button', { name: '+ เพิ่มแถว' }).click();
  await setRow(page, 3, IND2, 'ยาก', 2);
  await page.getByLabel('จำนวนนักเรียน (เลขที่ 1–N)').fill('7');
  await page.getByRole('button', { name: 'สร้างข้อสอบ' }).click();
  await expect(page.getByTestId('exam-meta')).toBeVisible();
  return /#\/exams\/([^?]+)/.exec(page.url())![1];
}

/** SVG กระดาษคำตอบของเลขที่ (จากหน้าพิมพ์จริง) */
export async function sheetSvg(page: Page, id: string, seat: number): Promise<string> {
  await page.goto(`/#/exams/${id}/print?doc=sheets`);
  const el = page.locator(`.sheet[data-seat="${seat}"] svg`).first();
  await expect(el).toBeVisible();
  return el.evaluate((n) => n.outerHTML);
}

export type Mark = [item: number, choice: number];
export function bubble(item: number, choice: number) {
  const b = TPL.bubbles;
  const col = Math.floor((item - 1) / b.rows), row = (item - 1) % b.rows;
  return { x: b.column_x[col] + b.first_bubble_offset_x + (choice - 1) * b.bubble_pitch_x, y: b.first_row_y + row * b.row_pitch_y };
}

/** ฝนด้วย "ดินสอ" แล้วถ่ายภาพ (เอียงเล็กน้อย พื้นโต๊ะเทา) → PNG */
export function photo(svg: string, marks: Mark[], opts: { rotate?: number; widthPx?: number } = {}): { png: Buffer; rgba: Uint8Array; w: number; h: number } {
  const pencil = marks.map(([i, c]) => { const p = bubble(i, c); return `<ellipse cx="${p.x + 0.15}" cy="${p.y - 0.1}" rx="2.2" ry="2.05" fill="#2a2a2a"/>`; }).join('');
  const inner = svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const W = 188, H = 262;
  const scene = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -26 ${W} ${H}">`
    + `<rect x="-20" y="-26" width="${W}" height="${H}" fill="#6b6b6b"/>`
    + `<g transform="rotate(${opts.rotate ?? 3} 74 105)"><rect width="148" height="210" fill="#fff"/>${inner}${pencil}</g></svg>`;
  const img = new Resvg(scene, { fitTo: { mode: 'width', value: opts.widthPx ?? 900 }, background: '#6b6b6b' }).render();
  return { png: img.asPng(), rgba: img.pixels, w: img.width, h: img.height };
}

/** วิดีโอ Y4M สำหรับกล้องจำลองของ Chromium (ภาพนิ่งวนซ้ำ) */
export function writeY4m(file: string, rgba: Uint8Array, w: number, h: number) {
  const W = w & ~1, H = h & ~1;
  const y = Buffer.alloc(W * H), uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = (r * w + c) * 4;
    y[r * W + c] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, uv]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]));
}

export async function answersInReview(page: Page): Promise<string[]> {
  await expect(page.getByTestId('answer-grid').locator('select').first()).toBeVisible();
  return page.getByTestId('answer-grid').locator('select').evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
}

