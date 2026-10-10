// ทดสอบเฟส 4: เอกสารพิมพ์ — แบบทดสอบรายชุด เฉลยครู กระดาษคำตอบ (พิมพ์เป็น PDF → แปลงเป็นภาพ → ถอด QR ทุกแผ่น/ตรวจมุมดำ) และไฟล์ Word
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { darkness, decodeQr, pdfInfo, rasterize } from './pdfTools';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TPL = JSON.parse(readFileSync(new URL('../../../data/answer_sheet_template_v1.json', import.meta.url), 'utf8'));
const IND1 = 'ค 1.1 ป.4/2', IND2 = 'ค 1.1 ป.4/11';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('อีเมล', { exact: true }).fill('demo@itembank.local');
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('demo1234');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByTestId('stat-ready')).toHaveText('264');
}

async function setRow(page: Page, n: number, ind: string, level: string, count: number) {
  await page.getByLabel(`ตัวชี้วัด แถว ${n}`).selectOption({ label: ind });
  await page.getByLabel(`ระดับ แถว ${n}`).selectOption({ label: level });
  await page.getByLabel(`จำนวน แถว ${n}`).fill(String(count));
}

/** สร้างชุด ป.4: 6 ข้อ 3 ชุด นักเรียน 7 คน แล้วคืน id ของชุด */
async function createExam(page: Page): Promise<string> {
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

async function printPdf(page: Page): Promise<Buffer> {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  return pdf;
}

function tmpFile(buf: Buffer, name: string) {
  const f = join(mkdtempSync(join(tmpdir(), 'p4-')), name);
  writeFileSync(f, buf);
  return f;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

test('แบบทดสอบรายชุดตรงกับลำดับข้อ/เฉลยของชุด และหัวกระดาษแก้ได้ (§7.1)', async ({ page }) => {
  const id = await createExam(page);
  // เฉลยรายชุดจากหน้ารายละเอียด
  const keys: Record<number, string[]> = {};
  for (const s of [1, 2, 3]) {
    await page.getByRole('button', { name: `ชุดที่ ${s}`, exact: true }).click();
    keys[s] = await page.getByTestId('set-table').locator('tbody tr td.key').allInnerTexts();
  }
  await page.getByRole('link', { name: /เอกสารพิมพ์/ }).click();
  await expect(page.getByTestId('print-exam')).toBeVisible();
  await expect(page.getByTestId('print-exam')).toContainText('จำนวน 6 ข้อ');
  await expect(page.getByTestId('print-exam')).toContainText('เวลา 12 นาที'); // 6 ข้อ × 2 นาที
  for (const s of [1, 2, 3]) {
    await page.getByRole('group', { name: 'เลือกชุด' }).getByRole('button', { name: `ชุดที่ ${s}` }).click();
    await expect(page.getByTestId('set-badge')).toContainText(String(s));
    const q = page.locator('.exam-doc .q');
    await expect(q).toHaveCount(6);
    const docKeys = await q.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-key'))));
    expect(docKeys.map((k) => ['①', '②', '③', '④'][k - 1])).toEqual(keys[s]);
    await expect(page.locator('.exam-doc .q-opts').first().locator('li')).toHaveCount(4);
  }
  // แก้หัวกระดาษ
  await page.getByLabel('ชื่อแบบทดสอบ (หัวกระดาษ)').fill('สอบย่อย ป.4 ครั้งที่ 3');
  await page.getByLabel('เวลาสอบ (นาที)').fill('45');
  await page.getByRole('button', { name: 'บันทึกหัวกระดาษ' }).click();
  await expect(page.getByRole('status')).toHaveText('บันทึกแล้ว');
  await expect(page.getByTestId('print-exam')).toContainText('สอบย่อย ป.4 ครั้งที่ 3');
  await expect(page.getByTestId('print-exam')).toContainText('เวลา 45 นาที');
  // PDF: A4 แนวตั้ง
  const info = pdfInfo(tmpFile(await printPdf(page), 'exam.pdf'));
  expect(Math.round(info.wMm)).toBe(210);
  expect(Math.round(info.hMm)).toBe(297);
  expect(page.url()).toContain(id);
});

test('กระดาษคำตอบ: A4 แนวนอน 2 แผ่น/หน้า ถอด QR ได้ครบทุกแผ่น ข้อมูลตรง และมุมดำอยู่ตำแหน่งที่กำหนด (§7.2)', async ({ page, browserName }, info) => {
  test.skip(info.project.name !== 'desktop', 'ตรวจ PDF ครั้งเดียวพอ');
  const id = await createExam(page);
  await page.goto(`/#/exams/${id}/print?doc=sheets`);
  await expect(page.getByTestId('print-sheets').locator('.sheet')).toHaveCount(7);
  const pdf = await printPdf(page);
  const pi = pdfInfo(tmpFile(pdf, 'sheets.pdf'));
  expect(pi.pages).toBe(4);
  expect(Math.round(pi.wMm)).toBe(297);
  expect(Math.round(pi.hMm)).toBe(210);
  const dpi = 200, px = dpi / 25.4;
  const { pages } = rasterize(pdf, dpi);
  expect(pages).toHaveLength(4);
  const found: Array<{ seat: number; set: number }> = [];
  pages.forEach((img, p) => {
    for (const half of [0, 1]) {
      const seat = p * 2 + half + 1;
      if (seat > 7) continue;
      const ox = half * 148 * px;
      // QR ตามตำแหน่งในแบบกระดาษ (เผื่อขอบ 3 มม.)
      const text = decodeQr(img, ox + (TPL.qr.x - 3) * px, (TPL.qr.y - 3) * px, (TPL.qr.size + 6) * px, (TPL.qr.size + 6) * px);
      expect(text, `QR เลขที่ ${seat}`).not.toBeNull();
      const [tag, exam, set, s, tpl] = text!.split('|');
      expect(tag).toBe('IB1');
      expect(exam).toBe(id);
      expect(Number(tpl)).toBe(1);
      found.push({ seat: Number(s), set: Number(set) });
      // มุมดำ: กลางสี่เหลี่ยมมืด รอบนอกขาว
      for (const [x, y] of TPL.corner_marks.top_left as number[][]) {
        const c = TPL.corner_marks.size / 2;
        expect(darkness(img, ox + (x + c) * px, (y + c) * px, 2 * px), `มุมดำเลขที่ ${seat}`).toBeGreaterThan(0.9);
        expect(darkness(img, ox + (x + c) * px, (y - 1.5) * px, 0.5 * px)).toBeLessThan(0.1);
      }
      // วงกลมข้อ 1 ตัวเลือก 1 ยังไม่ฝน (สว่าง) / ข้อ 7 ไม่มีวงกลม
      const b = TPL.bubbles;
      expect(darkness(img, ox + (b.column_x[0] + b.first_bubble_offset_x) * px, b.first_row_y * px, 0.8 * px)).toBeLessThan(0.5);
    }
  });
  expect(found).toEqual([1, 2, 3, 4, 5, 6, 7].map((seat) => ({ seat, set: ((seat - 1) % 3) + 1 })));
  expect(browserName).toBe('chromium');
});

test('เฉลยครูมีทุกชุด และดาวน์โหลด Word ได้ (ไฟล์ละชุด + zip)', async ({ page }) => {
  const id = await createExam(page);
  await page.goto(`/#/exams/${id}/print?doc=key`);
  for (const s of [1, 2, 3]) await expect(page.getByTestId('print-key').locator(`.key-set[data-set="${s}"] li`)).toHaveCount(6);
  await expect(page.getByTestId('print-key')).toContainText('ชุดที่ 1: เลขที่ 1, 4, 7');
  const [dk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word เฉลยครู' }).click()]);
  expect(dk.suggestedFilename()).toMatch(/_เฉลยครู\.docx$/);
  await page.getByRole('button', { name: 'แบบทดสอบ' }).click();
  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word ชุดที่ 1' }).click()]);
  expect(d1.suggestedFilename()).toMatch(/_ชุดที่1\.docx$/);
  const z1 = await JSZip.loadAsync(readFileSync(await d1.path()));
  const xml = await z1.file('word/document.xml')!.async('string');
  expect(xml).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
  expect(xml).toMatch(/<w:cols [^>]*w:num="2"/);
  const [dz] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word ทุกชุด + เฉลย (.zip)' }).click()]);
  const zip = await JSZip.loadAsync(readFileSync(await dz.path()));
  expect(Object.keys(zip.files).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/_ชุดที่1\.docx$/), expect.stringMatching(/_ชุดที่2\.docx$/),
    expect.stringMatching(/_ชุดที่3\.docx$/), expect.stringMatching(/_เฉลยครู\.docx$/)]));
  expect(Object.keys(zip.files)).toHaveLength(4);
});

test('ตัวอย่างเอกสารจริง: เศษส่วนซ้อน รูป และไม่ล้นแนวนอนบนมือถือ', async ({ page }) => {
  await page.goto('/#/dev/print-sample?doc=exam&set=2');
  const doc = page.getByTestId('print-exam');
  await expect(doc.locator('.q')).toHaveCount(14);
  expect(await doc.locator('.mx-frac').count()).toBeGreaterThan(20);
  expect(await doc.locator('.q-fig svg').count()).toBe(7);
  await expect(doc).toContainText('รูปอาจไม่ได้วาดตามมาตราส่วน');
  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);
});
