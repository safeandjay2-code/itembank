// ทดสอบเฟส 6: รายงานผล ส่งออก Excel/PDF ปิดชุด หมดอายุอัตโนมัติ (โหมดสาธิต)
// ผลตรวจใส่ผ่านเครื่องมือโหมดสาธิต (__itembankDemo.saveScan → repo.saveScan เส้นทางเดียวกับการตรวจจริง)
// ข้อมูลที่รู้ค่าล่วงหน้า: 6 ข้อ 7 คน · เลขที่ k (1–6) ตอบถูก 7−k ข้อแรกบนกระดาษ ที่เหลือตอบผิด · เลขที่ 7 ขาดสอบ
//   คะแนน 6,5,4,3,2,1 → เฉลี่ย 3.50 มัธยฐาน 3.5 S.D. (n−1) = √(17.5/5) = 1.87 ต่ำสุด 1 สูงสุด 6
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { createExam, login, TMP } from './scanTools';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await login(page);
});

/** ใส่ผลตรวจเลขที่ 1–6 ตามแบบที่รู้ค่าล่วงหน้า */
async function fillScans(page: Page, id: string, seats = [1, 2, 3, 4, 5, 6]) {
  await page.evaluate(async ({ id, seats }) => {
    const demo = (window as any).__itembankDemo;
    const exam = await demo.getExam(id);
    for (const seat of seats) {
      const setNo = exam.seats.find((s: any) => s.seatNo === seat).setNo;
      const keys = exam.sets.find((s: any) => s.setNo === setNo).entries.map((e: any) => e.key);
      const right = 7 - seat;
      const answers = keys.map((k: number, i: number) => (i < right ? k : (k % 4) + 1));
      await demo.saveScan(id, seat, setNo, answers, seat === 2 ? [3] : []);
    }
  }, { id, seats });
  // ออกจากหน้าปัจจุบันก่อน ให้หน้าที่เปิดต่อไปโหลดข้อมูลใหม่
  await page.goto('/#/coverage');
}

test('รายงานผล: ภาพรวมห้อง รายเลขที่ รายตัวชี้วัด รายข้อ ตรงกับค่าที่รู้ล่วงหน้า', async ({ page }) => {
  const id = await createExam(page);
  await fillScans(page, id);
  await page.goto(`/#/exams/${id}`);
  await page.getByTestId('go-report').click();
  await expect(page).toHaveURL(new RegExp(`#/exams/${id}/report`));
  await expect(page.getByTestId('report-meta')).toContainText('ตรวจแล้ว 6/7 คน');
  await expect(page.getByTestId('ov-mean')).toContainText('3.50');
  await expect(page.getByTestId('ov-mean')).toContainText('/ 6 (58.3%)');
  await expect(page.getByTestId('ov-sd')).toHaveText('1.87');
  await expect(page.getByTestId('ov-median')).toHaveText('3.5');
  await expect(page.getByTestId('ov-range')).toHaveText('1 – 6');
  await expect(page.getByTestId('ov-missing')).toContainText('เลขที่ 7');
  await expect(page.getByTestId('report-expiry')).toContainText('อีก 60 วัน');
  // การกระจาย: ร้อยละ 100, 83, 67, 50, 33, 17 (แสดงช่วง 90–100 ลงมา 0–9)
  const bars = await page.getByTestId('histogram').locator('.num').allTextContents();
  expect(bars).toEqual(['1 คน', '1 คน', '0 คน', '1 คน', '1 คน', '0 คน', '1 คน', '0 คน', '1 คน', '0 คน']);

  // รายเลขที่: 7 แถว เลขที่ 7 ยังไม่ตรวจ
  await page.getByRole('button', { name: 'รายเลขที่' }).click();
  await expect(page).toHaveURL(/tab=students/);
  const rows = page.getByTestId('student-table').locator('tbody tr');
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toContainText('6');
  await expect(rows.nth(6)).toContainText('ยังไม่ตรวจ / ขาดสอบ');
  await expect(page.getByTestId('student-table').locator('tr[data-seat="2"]')).toContainText('remark');

  // รายตัวชี้วัด 2 ตัว · รายข้อ 6 ข้อ มี p ทุกข้อ และ r (n = 6 ถึงเกณฑ์ขั้นต่ำ)
  await page.getByRole('button', { name: 'รายตัวชี้วัด' }).click();
  await expect(page.getByTestId('indicator-table').locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'รายข้อ' }).click();
  const cards = page.getByTestId('item-cards').locator('.item-card');
  await expect(cards).toHaveCount(6);
  for (const t of await cards.locator('[data-testid="p"]').allTextContents()) expect(t).toMatch(/p = \d\.\d\d/);
  for (const t of await cards.locator('[data-testid="r"]').allTextContents()) expect(t).toMatch(/r = -?\d\.\d\d/);
  // ข้อมูลรวมของตอบถูกทุกข้อ = ผลรวมคะแนน 21
  const correct = (await cards.locator('.metrics span:first-child b').allTextContents()).map((t) => Number(t.split('/')[0]));
  expect(correct.reduce((a, b) => a + b, 0)).toBe(21);
});

test('ส่งออก Excel: คะแนนรายเลขที่ครบ 1–7 ลงสมุดคะแนนได้ · พิมพ์ PDF ได้ทุกส่วน', async ({ page }, info) => {
  const id = await createExam(page);
  await fillScans(page, id);
  await page.goto(`/#/exams/${id}/report`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-xlsx').click()]);
  expect(dl.suggestedFilename()).toMatch(/^รายงานผล .+ ป\.4\.xlsx$/);
  const zip = await JSZip.loadAsync(readFileSync(await dl.path()));
  const wb = await zip.file('xl/workbook.xml')!.async('string');
  expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['สรุป', 'คะแนนรายเลขที่', 'รายตัวชี้วัด', 'วิเคราะห์รายข้อ', 'คำตอบรายเลขที่']);
  const sh = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
  const scores = [...sh.matchAll(/<c r="C(\d+)"[^>]*><v>(\d+)<\/v>/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(scores).toEqual([[2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1]]);
  expect(sh).toContain('ยังไม่ตรวจ/ขาดสอบ');

  test.skip(info.project.name !== 'desktop', 'พิมพ์ PDF ครั้งเดียวพอ');
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const f = join(TMP, 'report.pdf');
  writeFileSync(f, pdf);
  const text = execFileSync('pdftotext', ['-layout', f, '-']).toString();
  for (const h of ['ภาพรวมห้อง', 'คะแนนรายเลขที่', 'ผลรายตัวชี้วัด', 'วิเคราะห์รายข้อ']) expect(text).toContain(h);
  expect(text).not.toContain('ดาวน์โหลด Excel');           // ปุ่มไม่ถูกพิมพ์
  const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(execFileSync('pdfinfo', [f]).toString())!.slice(1).map(Number);
  expect(Math.round((size[0] / 72) * 25.4)).toBe(210);       // A4 แนวตั้ง
});

test('ปิดชุด: ต้องยืนยันก่อน → สถิติเข้าคลัง → ไม่เหลือข้อมูลรายเลขที่', async ({ page }) => {
  const id = await createExam(page);
  await fillScans(page, id);
  await page.goto(`/#/exams/${id}/report`);
  await page.getByTestId('go-close').click();
  await expect(page.getByTestId('close-facts')).toContainText('ตรวจแล้ว 6 จาก 7 คน');
  await expect(page.getByTestId('close-facts')).toContainText('remark ยังไม่ยืนยัน เลขที่ 2');
  await expect(page.getByTestId('close-confirm')).toBeDisabled();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('close-download').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(page.getByTestId('close-downloaded')).toBeVisible();
  await page.getByTestId('close-agree').check();
  await page.getByTestId('close-confirm').click();
  await expect(page.getByTestId('close-done')).toContainText('เข้าคลัง 6 ข้อ จากนักเรียน 6 คน');
  await expect(page.getByTestId('close-done')).toContainText('ลบคะแนนและคำตอบรายเลขที่ออกจากระบบแล้ว 6 เลขที่');

  // หลังปิด: ไม่มีข้อมูลรายเลขที่เหลือ
  const left = await page.evaluate(async (id) => (await (window as any).__itembankDemo.getExam(id)).hasResponses, id);
  expect(left).toBe(false);
  await page.getByRole('link', { name: 'ดูสรุปที่เก็บไว้' }).click();
  await expect(page.getByTestId('closed-banner')).toContainText('คะแนนและคำตอบรายเลขที่ถูกลบจากระบบแล้ว');
  await expect(page.getByTestId('ov-mean')).toContainText('3.50');
  await expect(page.getByRole('button', { name: 'รายเลขที่' })).toHaveCount(0);
  await expect(page.getByTestId('download-xlsx')).toHaveCount(0);
  await page.getByRole('button', { name: 'รายข้อ' }).click();
  await expect(page.getByTestId('item-cards').locator('.item-card')).toHaveCount(6);

  // หน้าชุดข้อสอบ: ปิดแล้ว ไม่มีปุ่มตรวจ ข้อในคลังมี n = 6
  await page.goto(`/#/exams/${id}`);
  await expect(page.getByTestId('exam-closed')).toContainText('สถิติรายข้อบันทึกเข้าคลัง 6 ข้อ');
  await expect(page.getByTestId('go-scan')).toHaveCount(0);
  for (const t of await page.getByTestId('exam-items').locator('.meta').allTextContents()) expect(t).toContain('n 6');
  // เมนูรายงานผล: อยู่ในกลุ่มปิดแล้ว
  await page.goto('/#/reports');
  await expect(page.getByTestId('report-closed-list')).toContainText('ปิดแล้ว');
  // ลบชุดที่ปิดแล้วได้
  await page.goto(`/#/exams/${id}`);
  await page.getByRole('button', { name: 'ลบชุดข้อสอบนี้…' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('สถิติที่บันทึกเข้าคลังแล้วยังอยู่');
  await page.getByRole('button', { name: 'ยืนยันลบ' }).click();
  await expect(page).toHaveURL(/#\/exams$/);
});

test('หมดอายุอัตโนมัติ: แจ้งเตือนล่วงหน้า 7 วัน แล้วลบข้อมูลรายเลขที่เมื่อครบ 60 วัน', async ({ page }) => {
  const id = await createExam(page);
  await fillScans(page, id, [1, 2, 3]);
  await page.goto(`/#/exams/${id}`);
  await expect(page.getByTestId('exam-expiry')).toContainText('อีก 60 วัน');
  // ยังไม่ถึงช่วงเตือน
  await page.goto('/#/exams');
  await expect(page.getByTestId('expiry-notice')).toHaveCount(0);
  // ผ่านไป 55 วัน → เหลือ 5 วัน: เตือนที่หน้าแรก/รายการชุด/รายงานผล
  await page.evaluate((id) => (window as any).__itembankDemo.ageExam(id, 55), id);
  await page.goto('/#/');
  await expect(page.getByTestId('expiry-notice')).toContainText('อีก 5 วัน');
  await page.goto('/#/reports');
  await expect(page.getByTestId('expiry-notice')).toBeVisible();
  await expect(page.getByTestId('report-open-list')).toContainText('ลบข้อมูลรายเลขที่ใน 5 วัน');
  // ครบกำหนด → เปิดรายการชุดแล้วระบบปิดให้เอง (สถานะหมดอายุ)
  await page.evaluate((id) => (window as any).__itembankDemo.ageExam(id, 6), id);
  await page.goto('/#/exams');
  await expect(page.getByTestId('exam-list')).toContainText('หมดอายุ');
  await expect(page.getByTestId('expiry-notice')).toHaveCount(0);
  await page.goto(`/#/exams/${id}/report`);
  await expect(page.getByTestId('closed-banner')).toContainText('หมดอายุ');
  await expect(page.getByTestId('closed-banner')).toContainText('บันทึกสถิติรายข้อเข้าคลัง 6 ข้อ (n = 3)');
  const left = await page.evaluate(async (id) => (await (window as any).__itembankDemo.getExam(id)).hasResponses, id);
  expect(left).toBe(false);
});

test('หน้ารายงาน/ปิดชุดบนมือถือไม่ล้นแนวนอน · ชุดที่ยังไม่มีผลตรวจ', async ({ page }) => {
  const id = await createExam(page);
  await page.goto(`/#/exams/${id}/report`);
  await expect(page.getByText('ยังไม่มีผลตรวจ')).toBeVisible();
  await fillScans(page, id);
  for (const tab of ['', '?tab=students', '?tab=indicators', '?tab=items']) {
    await page.goto(`/#/exams/${id}/report${tab}`);
    await expect(page.getByTestId('sec-overview')).toBeAttached();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, tab).toBeLessThanOrEqual(1);
  }
  await page.goto(`/#/exams/${id}/close`);
  await expect(page.getByTestId('close-confirm')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
