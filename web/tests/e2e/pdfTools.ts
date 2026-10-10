// เครื่องมือตรวจไฟล์ PDF ที่พิมพ์จากหน้าเว็บ: แปลงเป็นภาพ (pdftoppm) แล้วถอด QR และตรวจมุมดำ
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

export function pdfInfo(file: string) {
  const out = execFileSync('pdfinfo', [file]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(out)![1]);
  const [w, h] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(out)!.slice(1).map(Number);
  return { pages, wMm: (w / 72) * 25.4, hMm: (h / 72) * 25.4 };
}

export function rasterize(pdf: Buffer, dpi: number): { dir: string; pages: PNG[] } {
  const dir = mkdtempSync(join(tmpdir(), 'pdfimg-'));
  writeFileSync(join(dir, 'doc.pdf'), pdf);
  execFileSync('pdftoppm', ['-r', String(dpi), '-png', join(dir, 'doc.pdf'), join(dir, 'p')]);
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  return { dir, pages: files.map((f) => PNG.sync.read(readFileSync(join(dir, f)))) };
}

/** ตัดส่วนของภาพ (พิกเซล) */
export function crop(img: PNG, x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) {
    const src = ((y + r) * img.width + x) * 4;
    out.set(img.data.subarray(src, src + w * 4), r * w * 4);
  }
  return { data: out, width: w, height: h };
}

export function decodeQr(img: PNG, x: number, y: number, w: number, h: number): string | null {
  const c = crop(img, Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), Math.round(w), Math.round(h));
  return jsQR(c.data, c.width, c.height)?.data ?? null;
}

/** ค่าความมืดเฉลี่ย (0 = ขาว, 1 = ดำ) ของสี่เหลี่ยมรอบจุด */
export function darkness(img: PNG, cx: number, cy: number, half: number): number {
  let sum = 0, n = 0;
  for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++)
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const i = (y * img.width + x) * 4;
      sum += 1 - (img.data[i] + img.data[i + 1] + img.data[i + 2]) / (3 * 255);
      n += 1;
    }
  return sum / n;
}
