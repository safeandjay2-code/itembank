// สร้าง PDF ต้นฉบับกระดาษคำตอบ O-NET แบบ ON1 (A4 1 หน้าต่อชุด) + ภาพ PNG ไว้ตรวจ — SPEC-ONET §5
// ใช้:  npx vite-node scripts/onet-sheets.ts -- <โฟลเดอร์ปลายทาง> [S01,S02,...]
// ต้องมี Chromium ของ Playwright (ตั้ง PW_CHROMIUM ได้) · กระดาษคำตอบไม่มีข้อสอบ/เฉลย → สคริปต์นี้อยู่ใน repo ได้
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { onetSheetSvg } from '../src/modules/print/onetSheetSvg';
import { getOnetTemplate, ONET_CURRENT_TEMPLATE } from '../src/modules/print/onetTemplate';

const args = process.argv.slice(2).filter((a) => a !== '--');
const out = resolve(args[0] ?? 'onet-sheets');
const codes = (args[1] ?? 'S01,S02,S03,S04,S05,S06').split(',');
mkdirSync(out, { recursive: true });

const font = (w: number, sub: string) => readFileSync(resolve(__dirname, `../node_modules/@fontsource/sarabun/files/sarabun-${sub}-${w}-normal.woff2`)).toString('base64');
let css = '';
for (const w of [400, 700])
  for (const sub of ['thai', 'latin'])
    css += `@font-face{font-family:'Sarabun';font-weight:${w};src:url(data:font/woff2;base64,${font(w, sub)}) format('woff2');}\n`;
css += '@page{size:A4;margin:0}html,body{margin:0;padding:0}svg{display:block}';

export function sheetHtml(svg: string) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${css}</style></head><body>${svg}</body></html>`;
}

async function main() {
  const t = getOnetTemplate(ONET_CURRENT_TEMPLATE);
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  for (const code of codes) {
    const no = Number(code.slice(1));
    const svg = onetSheetSvg(t, { setCode: code, subtitle: `ชุดติว O-NET คณิตศาสตร์ ป.6 · ชุดที่ ${no}` });
    await page.setContent(sheetHtml(svg), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    writeFileSync(join(out, `กระดาษคำตอบ-ON1-${code}.pdf`), pdf);
    writeFileSync(join(out, `กระดาษคำตอบ-ON1-${code}.svg`), svg);
    console.log(`${code} → ${pdf.length} ไบต์`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
