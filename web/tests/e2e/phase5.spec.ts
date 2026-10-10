// ทดสอบเฟส 5: ตรวจกระดาษคำตอบ — อัปโหลดภาพ/PDF, เลขที่ซ้ำ, ตรวจทาน remark (กล้องอยู่ใน phase5-camera.spec.ts)
// กระดาษคำตอบที่ใช้ทดสอบ = SVG จริงจากหน้าพิมพ์ของระบบ + รอยฝนที่รู้ล่วงหน้า แปลงเป็นภาพในเครื่องทดสอบ
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answersInReview, createExam, login, photo, sheetSvg, TMP, type Mark } from './scanTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

test('เมนูตรวจด้วยกล้อง → เลือกชุด → หน้าตรวจ (ยังไม่ตรวจ 0/7) และไม่ล้นจอมือถือ', async ({ page }) => {
  const id = await createExam(page);
  await page.goto('/#/scan');
  await page.getByTestId('scan-exam-list').getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`#/exams/${id}/scan`));
  await expect(page.getByTestId('scan-progress')).toContainText('ตรวจแล้ว 0/7');
  await expect(page.getByTestId('camera-start')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // ปุ่มในหน้ารายละเอียดชุด
  await page.goto(`/#/exams/${id}`);
  await page.getByTestId('go-scan').click();
  await expect(page.getByTestId('scan-meta')).toContainText('6 ข้อ');
});

test('อัปโหลดภาพถ่าย: อ่านเลขที่/ชุด/คำตอบถูกต้อง · ฝน 2 ช่อง/ไม่ฝน · สแกนซ้ำ · ผลต่างให้ครูเลือก', async ({ page }) => {
  const id = await createExam(page);
  const svg = await sheetSvg(page, id, 3);
  const marks: Mark[] = [[1, 2], [2, 4], [3, 1], [3, 3], [5, 3], [6, 1]];   // ข้อ 3 ฝน 2 ช่อง · ข้อ 4 ไม่ฝน
  const f1 = join(TMP, 'seat3.png');
  writeFileSync(f1, photo(svg, marks).png);
  await page.goto(`/#/exams/${id}/scan?tab=upload`);
  await page.getByTestId('upload-input').setInputFiles(f1);
  const rows = page.getByTestId('upload-results').locator('li');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/เลขที่ 3 · ชุด 3 · \d\/6/);
  await expect(page.getByTestId('scan-progress')).toContainText('ตรวจแล้ว 1/7');

  // ผลตรวจ → ดูรายละเอียด: คำตอบตรงกับรอยฝน
  await page.getByRole('button', { name: /ผลตรวจ/ }).click();
  await expect(page.getByTestId('missing-seats')).toContainText('1, 2, 4–7');
  await page.getByTestId('scan-table').getByRole('link').first().click();
  expect(await answersInReview(page)).toEqual(['2', '4', 'multi', 'none', '3', '1']);
  const score = await page.getByTestId('review-score').textContent();
  await page.getByRole('button', { name: 'กลับ' }).click();
  await expect(page.getByTestId('scan-table')).toContainText(score!);

  // อัปโหลดไฟล์เดิมซ้ำ → แจ้งสแกนซ้ำ ไม่เพิ่มจำนวน
  await page.getByRole('button', { name: 'อัปโหลดภาพ/PDF' }).click();
  await page.getByTestId('upload-input').setInputFiles(f1);
  await expect(page.getByTestId('upload-results')).toContainText('สแกนซ้ำ');
  await expect(page.getByTestId('scan-progress')).toContainText('ตรวจแล้ว 1/7');

  // แผ่นเดิมแต่คำตอบต่าง (ครูให้นักเรียนแก้แล้วสแกนใหม่) → ถามก่อนเขียนทับ
  const f2 = join(TMP, 'seat3-new.png');
  writeFileSync(f2, photo(svg, [[1, 2], [2, 4], [3, 1], [4, 2], [5, 3], [6, 1]], { rotate: -4 }).png);
  await page.getByTestId('upload-input').setInputFiles(f2);
  await expect(page.getByTestId('conflict')).toContainText('เลขที่ 3 ตรวจไปแล้ว');
  await page.getByRole('button', { name: 'ใช้ผลใหม่' }).click();
  await expect(page.getByTestId('conflict')).toHaveCount(0);
  await page.getByRole('button', { name: /ผลตรวจ/ }).click();
  await page.getByTestId('scan-table').getByRole('link').first().click();
  expect(await answersInReview(page)).toEqual(['2', '4', '1', '2', '3', '1']);
});

test('ตรวจทาน: แก้คำตอบแล้วยืนยัน คะแนนเปลี่ยน · ลบผลเพื่อสแกนใหม่', async ({ page }) => {
  const id = await createExam(page);
  const svg = await sheetSvg(page, id, 5);
  const f = join(TMP, 'seat5.png');
  writeFileSync(f, photo(svg, [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]).png);
  await page.goto(`/#/exams/${id}/scan?tab=upload`);
  await page.getByTestId('upload-input').setInputFiles(f);
  await expect(page.getByTestId('upload-results')).toContainText('เลขที่ 5 · ชุด 2');
  await page.goto(`/#/exams/${id}/scan?tab=results&seat=5`);
  const grid = page.getByTestId('answer-grid');
  // เปลี่ยนทุกข้อเป็นเฉลย → 6/6
  const keys = await grid.locator('li .key').allTextContents();
  const circles = ['①', '②', '③', '④'];
  for (let i = 0; i < 6; i++) {
    const m = /[①②③④]/.exec(keys[i]);
    if (m) await grid.getByLabel(`ข้อ ${i + 1}`, { exact: true }).selectOption(String(circles.indexOf(m[0]) + 1));
  }
  await expect(page.getByTestId('review-score')).toHaveText('6/6');
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('scan-table')).toContainText('6/6');
  await page.getByTestId('scan-table').getByRole('link').first().click();
  await page.getByRole('button', { name: 'ลบผลตรวจ (เพื่อสแกนใหม่)' }).click();
  await page.getByRole('button', { name: 'ลบ', exact: true }).click();
  await expect(page.getByTestId('scan-progress')).toContainText('ตรวจแล้ว 0/7');
});

test('PDF จากเครื่องสแกน: กระดาษคำตอบทั้งชุด (A4 2 แผ่น/หน้า) อ่านได้ครบ 7 คน', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'สร้าง PDF ครั้งเดียวพอ');
  const id = await createExam(page);
  await page.goto(`/#/exams/${id}/print?doc=sheets`);
  await expect(page.getByTestId('print-sheets').locator('.sheet')).toHaveCount(7);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const f = join(TMP, 'all-sheets.pdf');
  writeFileSync(f, pdf);
  await page.goto(`/#/exams/${id}/scan?tab=upload`);
  await page.getByTestId('upload-input').setInputFiles(f);
  await expect(page.getByTestId('scan-progress')).toContainText('ตรวจแล้ว 7/7', { timeout: 60_000 });
  const rows = page.getByTestId('upload-results').locator('li');
  await expect(rows).toHaveCount(7);
  for (let s = 1; s <= 7; s++) await expect(page.getByTestId('upload-results')).toContainText(`เลขที่ ${s} · ชุด ${((s - 1) % 3) + 1} · 0/6`);
});

